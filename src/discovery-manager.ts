import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ConnectorConfig, AppConfig } from "./config.js";
import { createConnector, applyConnectorSettings } from "./discovery/connector-factory.js";
import { LineageAggregator } from "./discovery/lineageAggregator.js";
import type {
  ConnectionTestResult,
  DiscoveredDatabase,
  DiscoveryRunSummary,
  RawLineageEdge,
  LineageAggregatorSummary,
  DiscoveryConnector,
} from "./discovery/types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ConnectorSummary {
  id: string;
  type: string;
  host: string;
  port: number;
  database: string;
  hasCachedDiscovery: boolean;
  lastDiscoveredAt?: string;
}

export interface SearchResult {
  connector: string;
  schema: string;
  table: string;
  column: string;
  dataType: string;
  fullDataType: string;
}

// ---------------------------------------------------------------------------
// Discovery Manager
// ---------------------------------------------------------------------------

export class DiscoveryManager {
  /** Max regex pattern length to prevent ReDoS */
  private static readonly MAX_REGEX_LENGTH = 500;
  private connectors: ConnectorConfig[];
  private dataDir: string;
  private cache = new Map<string, DiscoveredDatabase>();
  private cacheTimestamps = new Map<string, number>();
  private cacheTtlMs: number;
  private maxCacheEntries: number;
  private lineageAggregator: LineageAggregator;
  private inFlightDiscoveries = new Map<string, Promise<DiscoveryRunSummary>>();
  private jdbcBaseUrl?: string;
  private jdbcTimeoutMs?: number;

  constructor(config: AppConfig) {
    this.connectors = config.connectors;
    this.dataDir = config.dataDir;
    this.jdbcBaseUrl = config.jdbc?.baseUrl;
    this.jdbcTimeoutMs = config.jdbc?.timeoutMs;
    this.cacheTtlMs = (config.discovery?.cacheTtlHours ?? 24) * 3600_000;
    this.maxCacheEntries = config.discovery?.maxCacheEntries ?? 100;
    this.lineageAggregator = new LineageAggregator(config.lineage?.sourceWeights);

    // Ensure data dir exists
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }

    // Load cached discovery results from disk
    for (const c of this.connectors) {
      const cached = this.loadFromDisk(c.id);
      if (cached) {
        this.cache.set(c.id, cached);
        this.cacheTimestamps.set(c.id, cached.discoveredAt instanceof Date ? cached.discoveredAt.getTime() : new Date(cached.discoveredAt as any).getTime());
        this.extractFkLineage(c.id, cached);
      }
    }
  }

  // ── Connector CRUD ──

  listConnectors(): ConnectorSummary[] {
    return this.connectors.map((c) => {
      const cached = this.cache.get(c.id);
      return {
        id: c.id,
        type: c.type,
        host: c.host,
        port: c.port,
        database: c.database,
        hasCachedDiscovery: !!cached,
        lastDiscoveredAt: cached?.discoveredAt
          ? new Date(cached.discoveredAt).toISOString()
          : undefined,
      };
    });
  }

  getConnectorConfig(id: string): ConnectorConfig | undefined {
    return this.connectors.find((c) => c.id === id);
  }

  addConnector(config: ConnectorConfig): void {
    if (this.connectors.some((c) => c.id === config.id)) {
      throw new Error(`Connector '${config.id}' already exists`);
    }
    this.connectors.push(config);
  }

  updateConnector(id: string, partial: Partial<ConnectorConfig>): void {
    const idx = this.connectors.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error(`Connector '${id}' not found`);
    this.connectors[idx] = { ...this.connectors[idx], ...partial, id };
  }

  removeConnector(id: string): void {
    const idx = this.connectors.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error(`Connector '${id}' not found`);
    this.connectors.splice(idx, 1);
    this.cache.delete(id);
    this.cacheTimestamps.delete(id);
    this.inFlightDiscoveries.delete(id);
  }

  // ── Discovery operations ──

  async testConnection(id: string): Promise<ConnectionTestResult> {
    const config = this.requireConnector(id);
    const connector = createConnector(config.type, this.jdbcBaseUrl, this.jdbcTimeoutMs);
    applyConnectorSettings(connector, config);
    try {
      return await connector.testConnection(config);
    } finally {
      await connector.disconnect();
    }
  }

  async discoverMetadata(id: string): Promise<DiscoveryRunSummary> {
    // Guard against concurrent discoveries on the same connector
    const existing = this.inFlightDiscoveries.get(id);
    if (existing) return existing;

    const promise = this.runDiscovery(id);
    this.inFlightDiscoveries.set(id, promise);
    // Clean up the in-flight entry when the underlying discovery actually
    // settles — NOT when Promise.race wins. Otherwise a timeout could
    // clear the entry while the real discovery is still running, letting
    // a subsequent call spawn a duplicate discovery against the same DB.
    promise.finally(() => {
      // Only delete if the stored promise is still this one (paranoia
      // against a future refactor that inserts a newer promise first).
      if (this.inFlightDiscoveries.get(id) === promise) {
        this.inFlightDiscoveries.delete(id);
      }
    });

    // Add a timeout to prevent indefinite hangs (default 10 minutes)
    const timeoutMs = 10 * 60 * 1000;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutTimer = setTimeout(() => reject(new Error(`Discovery timeout: connector '${id}' exceeded ${timeoutMs / 1000}s`)), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }
  }

  private async runDiscovery(id: string): Promise<DiscoveryRunSummary> {
    const config = this.requireConnector(id);
    const connector = createConnector(config.type, this.jdbcBaseUrl, this.jdbcTimeoutMs);
    applyConnectorSettings(connector, config);

    try {
      const result = await connector.discover(config);

      // Cache in memory and on disk (enforce max entries)
      this.evictIfNeeded();
      this.cache.set(id, result);
      this.cacheTimestamps.set(id, Date.now());
      this.saveToDisk(id, result);

      // Extract FK lineage
      this.extractFkLineage(id, result);

      // Build summary
      return this.buildSummary(result);
    } finally {
      await connector.disconnect();
    }
  }

  getDiscoveredSchema(id: string): DiscoveredDatabase | null {
    const cached = this.cache.get(id);
    if (!cached) return null;

    // Evict if TTL expired
    const ts = this.cacheTimestamps.get(id) ?? 0;
    if (Date.now() - ts > this.cacheTtlMs) {
      this.cache.delete(id);
      this.cacheTimestamps.delete(id);
      return null;
    }

    return cached;
  }

  // ── Lineage ──

  getLineage(connectorId?: string, table?: string): RawLineageEdge[] {
    let edges = this.lineageAggregator.getAllEdges();

    if (connectorId) {
      edges = edges.filter(
        (e) =>
          e.source_element_pid.includes(connectorId) ||
          e.target_element_pid.includes(connectorId),
      );
    }

    if (table) {
      const upper = table.toUpperCase();
      edges = edges.filter(
        (e) =>
          e.source_element_pid.toUpperCase().includes(upper) ||
          e.target_element_pid.toUpperCase().includes(upper),
      );
    }

    return edges;
  }

  getLineageSummary(): LineageAggregatorSummary {
    return this.lineageAggregator.getSummary();
  }

  // ── Search ──

  searchColumns(pattern: string, connectorId?: string): SearchResult[] {
    if (pattern.length > DiscoveryManager.MAX_REGEX_LENGTH) {
      throw new Error(`Regex pattern too long (max ${DiscoveryManager.MAX_REGEX_LENGTH} characters)`);
    }
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, "i");
    } catch {
      throw new Error(`Invalid regex pattern: ${pattern}`);
    }
    const results: SearchResult[] = [];

    const connectorIds = connectorId
      ? [connectorId]
      : Array.from(this.cache.keys());

    for (const cId of connectorIds) {
      const db = this.cache.get(cId);
      if (!db) continue;

      for (const schema of db.schemas) {
        for (const table of [...schema.tables, ...schema.views]) {
          for (const col of table.columns) {
            if (regex.test(col.columnName)) {
              results.push({
                connector: cId,
                schema: schema.schemaName,
                table: table.tableName,
                column: col.columnName,
                dataType: col.dataType,
                fullDataType: col.fullDataType,
              });
            }
          }
        }
      }
    }

    return results;
  }

  // ── Cleanup ──

  async close(): Promise<void> {
    // Nothing to close — connectors are created per-operation
  }

  // ── Private helpers ──

  private evictIfNeeded(): void {
    while (this.cache.size >= this.maxCacheEntries) {
      // Evict oldest entry by timestamp
      let oldestId: string | undefined;
      let oldestTs = Infinity;
      for (const [id, ts] of this.cacheTimestamps) {
        if (ts < oldestTs) { oldestTs = ts; oldestId = id; }
      }
      if (oldestId) {
        this.cache.delete(oldestId);
        this.cacheTimestamps.delete(oldestId);
      } else {
        break;
      }
    }
  }

  private requireConnector(id: string): ConnectorConfig {
    const config = this.connectors.find((c) => c.id === id);
    if (!config) throw new Error(`Connector '${id}' not found`);
    return config;
  }

  private extractFkLineage(connectorId: string, db: DiscoveredDatabase): void {
    const edges: RawLineageEdge[] = [];

    for (const schema of db.schemas) {
      for (const table of [...schema.tables, ...schema.views]) {
        for (const fk of table.foreignKeys) {
          if (fk.columns.length !== fk.referencedColumns.length) {
            console.warn(`[discovery] FK ${fk.constraintName} on ${table.tableName}: columns.length (${fk.columns.length}) !== referencedColumns.length (${fk.referencedColumns.length}), skipping`);
            continue;
          }
          // Create an edge for each column pair in the FK
          for (let i = 0; i < fk.columns.length; i++) {
            const sourceCol = fk.columns[i];
            const targetCol = fk.referencedColumns[i];

            edges.push({
              source_element_pid: `${sourceCol}@${table.tableName}@${schema.schemaName}@${connectorId}`,
              target_element_pid: `${targetCol}@${fk.referencedTable}@${fk.referencedSchema}@${connectorId}`,
              source_type: "FK",
            });
          }
        }
      }
    }

    if (edges.length > 0) {
      this.lineageAggregator.addEdges(edges);
    }
  }

  private buildSummary(db: DiscoveredDatabase): DiscoveryRunSummary {
    let tablesFound = 0;
    let viewsFound = 0;
    let columnsFound = 0;
    let foreignKeysFound = 0;
    let indexesFound = 0;

    for (const schema of db.schemas) {
      tablesFound += schema.tables.length;
      viewsFound += schema.views.length;
      for (const table of [...schema.tables, ...schema.views]) {
        columnsFound += table.columns.length;
        foreignKeysFound += table.foreignKeys.length;
        indexesFound += table.indexes.length;
      }
    }

    return {
      schemasFound: db.schemas.length,
      tablesFound,
      viewsFound,
      columnsFound,
      foreignKeysFound,
      indexesFound,
      durationMs: db.durationMs,
      errors: [],
    };
  }

  /** Load cached discovery from disk, bypassing TTL. Used by scheduler for pre-discovery snapshot. */
  getLastDiscoverySnapshot(id: string): DiscoveredDatabase | null {
    return this.loadFromDisk(id);
  }

  private loadFromDisk(connectorId: string): DiscoveredDatabase | null {
    const filePath = resolve(this.dataDir, `${connectorId}.discovery.json`);
    if (!existsSync(filePath)) return null;
    try {
      const raw = JSON.parse(readFileSync(filePath, "utf-8"));
      // Restore Date object
      raw.discoveredAt = new Date(raw.discoveredAt);
      return raw as DiscoveredDatabase;
    } catch (err) {
      console.warn(`[discovery] Failed to load cache for '${connectorId}': ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  private saveToDisk(connectorId: string, db: DiscoveredDatabase): void {
    const filePath = resolve(this.dataDir, `${connectorId}.discovery.json`);
    try {
      writeFileSync(filePath, JSON.stringify(db, null, 2), "utf-8");
    } catch (err) {
      console.error(`[discovery] Failed to save cache for '${connectorId}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
