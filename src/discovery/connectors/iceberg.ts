/**
 * DF360 Metadata Discovery — Iceberg REST Catalog Connector
 *
 * Crawls Apache Iceberg REST Catalog (e.g., Apache Gravitino) via HTTP
 * to extract namespaces, tables, and column schemas.
 *
 * Two-tier: namespace → table
 * No JDBC — pure HTTP calls to the Iceberg REST Catalog API.
 * Iceberg tables don't have traditional FKs/PKs/indexes.
 *
 * ConnectionConfig mapping:
 *   host     = catalog hostname (e.g., localhost)
 *   port     = 9001 (default for Gravitino)
 *   user     = 'token' (optional, convention)
 *   password = Bearer token (optional, empty string for no auth)
 *   database = catalog prefix (optional, can be empty)
 *   schemas  = optional namespace filter
 */

import {
  sanitizeErrorMessage,
  type ConnectionConfig,
  type ConnectionTestResult,
  type DiscoveredColumn,
  type DiscoveredDatabase,
  type DiscoveredSchema,
  type DiscoveredTable,
  type DiscoveryConnector,
} from '../types.js';

export class IcebergConnector implements DiscoveryConnector {
  readonly type = 'ICEBERG' as const;
  private baseUrl = '';
  private token = '';
  /** Configurable: fetch timeout in ms (default: 60000) */
  fetchTimeoutMs = 60000;

  async testConnection(config: ConnectionConfig): Promise<ConnectionTestResult> {
    const start = Date.now();
    this.buildBaseUrl(config);

    try {
      const resp = await this.apiGet('/config');
      const data = await resp.json() as Record<string, unknown>;
      return {
        success: true,
        serverVersion: `Iceberg REST Catalog (${JSON.stringify(data).slice(0, 80)})`,
        latencyMs: Date.now() - start,
      };
    } catch (err: unknown) {
      return {
        success: false,
        errorMessage: sanitizeErrorMessage(err),
        latencyMs: Date.now() - start,
      };
    }
  }

  async discover(config: ConnectionConfig): Promise<DiscoveredDatabase> {
    const start = Date.now();
    this.buildBaseUrl(config);

    // 1. List namespaces
    const namespaceNames = await this.discoverNamespaces(config.schemas);
    console.log(`[iceberg] Found ${namespaceNames.length} namespace(s): ${namespaceNames.join(', ')}`);

    // 2. For each namespace, discover tables
    const schemas: DiscoveredSchema[] = [];
    for (const ns of namespaceNames) {
      const { tables, views } = await this.discoverTables(ns);
      schemas.push({ schemaName: ns, tables, views });
    }

    // Build version string from config endpoint
    let serverVersion = 'Iceberg REST Catalog';
    try {
      const configResp = await this.apiGet('/config');
      const configData = await configResp.json() as { defaults?: Record<string, string>; overrides?: Record<string, string> };
      if (configData.defaults?.['warehouse']) {
        serverVersion = `Iceberg REST Catalog — warehouse: ${configData.defaults['warehouse']}`;
      }
    } catch {
      // keep default version string
    }

    return {
      databaseName: config.database || 'iceberg',
      serverVersion,
      databaseType: 'ICEBERG',
      schemas,
      discoveredAt: new Date(),
      durationMs: Date.now() - start,
    };
  }

  async disconnect(): Promise<void> {
    // No persistent connection to close — REST API is stateless
  }

  // ---------------------------------------------------------------------------
  // Private — URL construction
  // ---------------------------------------------------------------------------

  private buildBaseUrl(config: ConnectionConfig): void {
    const protocol = config.port === 443 ? 'https' : 'http';
    this.baseUrl = `${protocol}://${config.host}:${config.port}/iceberg/v1`;
    this.token = config.password || '';
  }

  // ---------------------------------------------------------------------------
  // Private — Namespace discovery
  // ---------------------------------------------------------------------------

  private async discoverNamespaces(configSchemas?: string[]): Promise<string[]> {
    if (configSchemas && configSchemas.length > 0) {
      return configSchemas;
    }

    const resp = await this.apiGet('/namespaces');
    const data = await resp.json() as { namespaces?: string[][] };

    // Iceberg REST API returns namespaces as arrays of name parts, e.g. [["tpch"], ["analytics"]]
    return (data.namespaces || []).map(parts => parts.join('.'));
  }

  // ---------------------------------------------------------------------------
  // Private — Table discovery
  // ---------------------------------------------------------------------------

  private async discoverTables(namespace: string): Promise<{ tables: DiscoveredTable[]; views: DiscoveredTable[] }> {
    // List tables in namespace
    const listResp = await this.apiGet(`/namespaces/${encodeURIComponent(namespace)}/tables`);
    const listData = await listResp.json() as { identifiers?: Array<{ namespace: string[]; name: string }> };

    const tables: DiscoveredTable[] = [];

    for (const ident of listData.identifiers || []) {
      try {
        const detailResp = await this.apiGet(
          `/namespaces/${encodeURIComponent(namespace)}/tables/${encodeURIComponent(ident.name)}`,
        );
        const tableData = await detailResp.json() as IcebergTableMetadata;

        const table = this.mapTable(ident.name, tableData);
        tables.push(table);
      } catch (err) {
        console.warn(`[iceberg] Failed to fetch table ${namespace}.${ident.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Also check for views (Iceberg REST API may have a separate views endpoint)
    const views: DiscoveredTable[] = [];
    try {
      const viewsResp = await this.apiGet(`/namespaces/${encodeURIComponent(namespace)}/views`);
      const viewsData = await viewsResp.json() as { identifiers?: Array<{ namespace: string[]; name: string }> };

      for (const ident of viewsData.identifiers || []) {
        try {
          const detailResp = await this.apiGet(
            `/namespaces/${encodeURIComponent(namespace)}/views/${encodeURIComponent(ident.name)}`,
          );
          const viewData = await detailResp.json() as IcebergTableMetadata;
          const view = this.mapTable(ident.name, viewData);
          view.tableType = 'VIEW';
          views.push(view);
        } catch {
          // Views may not have detailed metadata — skip
        }
      }
    } catch {
      // Views endpoint may not exist — that's fine
    }

    return { tables, views };
  }

  // ---------------------------------------------------------------------------
  // Private — Table and column mapping
  // ---------------------------------------------------------------------------

  private mapTable(tableName: string, meta: IcebergTableMetadata): DiscoveredTable {
    // Find the current schema from metadata.schemas using current-schema-id
    const currentSchemaId = meta.metadata?.['current-schema-id'] ?? 0;
    const schemas = meta.metadata?.schemas || [];
    const currentSchema = schemas.find(s => s['schema-id'] === currentSchemaId) || schemas[0];

    const columns = this.mapColumns(currentSchema?.fields || []);

    // Build table comment from partition specs and properties
    const commentParts: string[] = [];

    // Partition specs
    const partSpecs = meta.metadata?.['partition-specs'];
    if (partSpecs && partSpecs.length > 0) {
      const activeSpec = partSpecs[partSpecs.length - 1]; // latest spec
      if (activeSpec.fields && activeSpec.fields.length > 0) {
        const partFields = activeSpec.fields.map(
          (f: IcebergPartitionField) => `${f.name}(${f.transform})`,
        ).join(', ');
        commentParts.push(`Partitioned by: ${partFields}`);
      }
    }

    // Sort orders
    const sortOrders = meta.metadata?.['sort-orders'];
    if (sortOrders && sortOrders.length > 0) {
      const activeSort = sortOrders[sortOrders.length - 1];
      if (activeSort.fields && activeSort.fields.length > 0) {
        commentParts.push(`Sort order: ${activeSort.fields.length} field(s)`);
      }
    }

    // Properties
    const props = meta.metadata?.properties;
    if (props) {
      const propKeys = Object.keys(props);
      if (propKeys.length > 0) {
        commentParts.push(`Properties: ${propKeys.length} key(s)`);
      }
    }

    // Estimated row count from snapshot summary
    let estimatedRowCount: number | undefined;
    const snapshots = meta.metadata?.snapshots;
    if (snapshots && snapshots.length > 0) {
      const latestSnapshot = snapshots[snapshots.length - 1];
      const totalRecords = latestSnapshot.summary?.['total-records'];
      if (totalRecords !== undefined) {
        estimatedRowCount = parseInt(String(totalRecords), 10);
      }
    }

    return {
      tableName,
      tableType: 'TABLE',
      estimatedRowCount,
      tableComment: commentParts.length > 0 ? commentParts.join(' | ') : undefined,
      columns,
      foreignKeys: [],  // Iceberg has no FKs
      indexes: [],      // Iceberg has no indexes
    };
  }

  private mapColumns(fields: IcebergField[]): DiscoveredColumn[] {
    return fields.map((field, idx) => {
      const { dataType, fullDataType, charMaxLen, numPrec, numScale } = this.parseIcebergType(field.type);

      return {
        columnName: field.name,
        ordinalPosition: idx + 1,
        dataType,
        fullDataType,
        isNullable: !field.required,
        columnDefault: undefined,
        characterMaxLength: charMaxLen,
        numericPrecision: numPrec,
        numericScale: numScale,
        columnComment: field.doc || undefined,
        isPrimaryKey: false,
        isAutoIncrement: false,
      };
    });
  }

  /**
   * Parse Iceberg type strings into DF360-compatible fields.
   * Handles simple types (long, string, boolean) and parameterized types (decimal(15,2), fixed[16]).
   * Complex types (struct, list, map) are serialized as-is.
   */
  private parseIcebergType(type: string | Record<string, unknown>): {
    dataType: string;
    fullDataType: string;
    charMaxLen?: number;
    numPrec?: number;
    numScale?: number;
  } {
    // Complex types (struct, list, map) come as objects
    if (typeof type !== 'string') {
      const complexType = (type as { type?: string }).type || 'struct';
      return {
        dataType: complexType,
        fullDataType: JSON.stringify(type),
      };
    }

    const typeLower = type.toLowerCase();

    // decimal(precision, scale)
    const decMatch = typeLower.match(/^decimal\((\d+),\s*(\d+)\)$/);
    if (decMatch) {
      return {
        dataType: 'decimal',
        fullDataType: type,
        numPrec: parseInt(decMatch[1], 10),
        numScale: parseInt(decMatch[2], 10),
      };
    }

    // fixed[length]
    const fixedMatch = typeLower.match(/^fixed\[(\d+)\]$/);
    if (fixedMatch) {
      return {
        dataType: 'fixed',
        fullDataType: type,
        charMaxLen: parseInt(fixedMatch[1], 10),
      };
    }

    return {
      dataType: typeLower,
      fullDataType: type,
    };
  }

  // ---------------------------------------------------------------------------
  // Private — HTTP client
  // ---------------------------------------------------------------------------

  private async apiGet(path: string): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    // Only add auth header when a real token is provided (skip for 'none' placeholder)
    if (this.token && this.token !== 'none') {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.fetchTimeoutMs ?? 60000);

    try {
      const resp = await fetch(url, { headers, signal: controller.signal });

      if (!resp.ok) {
        const body = await resp.text();
        // Mask Authorization/Bearer content that services sometimes echo back in errors.
        const safeBody = body
          .replace(/bearer\s+[A-Za-z0-9._~+/=-]*/gi, 'Bearer *****')
          .replace(/authorization["':\s]*[^\s"',}]+/gi, 'Authorization: *****')
          .replace(/x-api-key["':\s]*[^\s"',}]+/gi, 'X-Api-Key: *****')
          .replace(/x-auth-token["':\s]*[^\s"',}]+/gi, 'X-Auth-Token: *****')
          .replace(/cookie["':\s]*[^\s"',}]+/gi, 'Cookie: *****')
          .replace(/["']?(api[_-]?key|access[_-]?token|refresh[_-]?token|secret)["']?\s*[:=]\s*["']?[^\s"',}]+/gi,
                   (_m, k) => `${k}: *****`);
        throw new Error(`Iceberg REST API ${resp.status}: ${safeBody}`);
      }

      return resp;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// Iceberg REST API response types
// ---------------------------------------------------------------------------

interface IcebergField {
  id: number;
  name: string;
  required: boolean;
  type: string | Record<string, unknown>;
  doc?: string;
}

interface IcebergPartitionField {
  name: string;
  transform: string;
  'source-id': number;
  'field-id': number;
}

interface IcebergTableMetadata {
  metadata?: {
    'format-version'?: number;
    'table-uuid'?: string;
    'current-schema-id'?: number;
    schemas?: Array<{
      type: string;
      'schema-id': number;
      fields: IcebergField[];
    }>;
    'partition-specs'?: Array<{
      'spec-id': number;
      fields: IcebergPartitionField[];
    }>;
    'sort-orders'?: Array<{
      'order-id': number;
      fields: unknown[];
    }>;
    properties?: Record<string, string>;
    snapshots?: Array<{
      'snapshot-id': number;
      summary?: Record<string, string>;
    }>;
  };
}
