import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ConnectionConfig, DatabaseType, LineageSourceKind } from "./discovery/types.js";

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface ConnectorConfig extends ConnectionConfig {
  id: string;
  type: DatabaseType;

  // ── Per-connector tuning (optional, sensible defaults) ──

  /** Operational lineage lookback window in hours (default: 24; Databricks default: 720) */
  lineageLookbackHours?: number;
  /** SQL query batch size for query text retrieval — Redshift (default: 200) */
  batchSize?: number;
  /** Max SYS_QUERY_TEXT sequence number — Redshift (default: 16) */
  queryTextSequenceLimit?: number;
  /** SQL Statement API wait timeout — Databricks (default: "50s") */
  waitTimeout?: string;
  /** Max poll iterations for statement execution — Databricks (default: 60) */
  maxPollIterations?: number;
  /** Poll interval between retries in ms — Databricks (default: 2000) */
  pollIntervalMs?: number;
  /** Snowflake warehouse name (default: "COMPUTE_WH") */
  warehouse?: string;
  /** BigQuery region for INFORMATION_SCHEMA queries (default: "region-us") */
  region?: string;
  /** MSSQL: enable encryption (default: false) */
  encrypt?: boolean;
  /** MSSQL: trust self-signed certificates (default: true) */
  trustServerCertificate?: boolean;
  /** REST API fetch timeout in ms — Databricks, Dremio, Iceberg (default: 60000) */
  fetchTimeoutMs?: number;
}

export interface ServerConfig {
  /** Default HTTP port (default: 8090) */
  port?: number;
  /** Graceful shutdown timeout in ms (default: 10000) */
  shutdownTimeoutMs?: number;
  /** Express JSON body size limit (default: "1mb") */
  jsonBodySizeLimit?: string;
}

export interface DiscoverySettings {
  /** Default connection timeout for all connectors in ms (default: 10000) */
  connectTimeoutMs?: number;
  /** Cache TTL in hours — entries older than this are evicted on access (default: 24) */
  cacheTtlHours?: number;
  /** Max cache entries — oldest evicted when exceeded (default: 100) */
  maxCacheEntries?: number;
}

export interface IngestionTargetConfig {
  /** Base URL of the ingestion API (default: http://localhost:{port}/api/v1/ingest) */
  baseUrl?: string;
  /** Bearer token for authentication (required for real DCF) */
  apiKey?: string;
  /** Request timeout in ms (default: 30000) */
  timeoutMs?: number;
}

export interface LineageConfig {
  /** Weight-based priority for lineage source types (higher = wins on conflict) */
  sourceWeights?: Partial<Record<LineageSourceKind, number>>;
}

export interface SchedulerConfig {
  /** Enable the scheduler engine (default: true) */
  enabled?: boolean;
  /** Tick interval in ms (default: 5000) */
  tickIntervalMs?: number;
}

export interface JdbcConfig {
  /** Base URL of the Java JDBC sidecar service (default: "http://localhost:8091/api/jdbc") */
  baseUrl?: string;
  /** Whether JDBC sidecar is enabled (default: true) */
  enabled?: boolean;
  /** HTTP request timeout in ms for calls to the sidecar (default: 300000 = 5 min) */
  timeoutMs?: number;
}

export interface AppConfig {
  connectors: ConnectorConfig[];
  server?: ServerConfig;
  discovery?: DiscoverySettings;
  ingestion?: IngestionTargetConfig;
  lineage?: LineageConfig;
  scheduler?: SchedulerConfig;
  jdbc?: JdbcConfig;
  dataDir: string;
}

// ---------------------------------------------------------------------------
// File config shape (what config.json looks like)
// ---------------------------------------------------------------------------

interface FileConnectorEntry {
  id: string;
  type: DatabaseType;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  schemas?: string[];
  connectTimeout?: number;
  warehouseId?: string;
  projectId?: string;
  // Per-connector tuning
  lineageLookbackHours?: number;
  batchSize?: number;
  queryTextSequenceLimit?: number;
  waitTimeout?: string;
  maxPollIterations?: number;
  pollIntervalMs?: number;
  warehouse?: string;
  region?: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
  fetchTimeoutMs?: number;
}

interface FileConfig {
  connectors: FileConnectorEntry[];
  server?: ServerConfig;
  discovery?: DiscoverySettings;
  ingestion?: IngestionTargetConfig;
  lineage?: LineageConfig;
  scheduler?: SchedulerConfig;
  jdbc?: JdbcConfig;
}

// ---------------------------------------------------------------------------
// Load config
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

export function loadConfig(configPath?: string): AppConfig {
  const filePath = configPath ?? resolve(PROJECT_ROOT, "config.json");

  if (!existsSync(filePath)) {
    throw new Error(
      `Config file not found. Create config.json (or use --config <path>) and fill in your database credentials.\n` +
      `See config.example.json for reference.`,
    );
  }

  let raw: FileConfig;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf-8")) as FileConfig;
  } catch (err) {
    throw new Error(`Failed to parse config file: ${err instanceof Error ? err.message : err}`);
  }

  if (!raw.connectors || raw.connectors.length === 0) {
    throw new Error("config.json: at least one connector is required");
  }

  for (const c of raw.connectors) {
    if (!c.id) throw new Error("config.json: each connector must have an 'id'");
    if (!c.type) throw new Error(`config.json: connector '${c.id}' is missing 'type'`);
  }

  const connectors: ConnectorConfig[] = raw.connectors.map((c) => ({
    id: c.id,
    type: c.type,
    host: c.host,
    port: c.port,
    user: c.user,
    password: c.password,
    database: c.database,
    schemas: c.schemas,
    connectTimeout: c.connectTimeout ?? raw.discovery?.connectTimeoutMs ?? 10000,
    warehouseId: c.warehouseId,
    projectId: c.projectId,
    // Per-connector tuning (pass through as-is; connectors use defaults if absent)
    lineageLookbackHours: c.lineageLookbackHours,
    batchSize: c.batchSize,
    queryTextSequenceLimit: c.queryTextSequenceLimit,
    waitTimeout: c.waitTimeout,
    maxPollIterations: c.maxPollIterations,
    pollIntervalMs: c.pollIntervalMs,
    warehouse: c.warehouse,
    region: c.region,
    encrypt: c.encrypt,
    trustServerCertificate: c.trustServerCertificate,
    fetchTimeoutMs: c.fetchTimeoutMs,
  }));

  const dataDir = resolve(PROJECT_ROOT, "data");

  return {
    connectors,
    server: raw.server,
    discovery: raw.discovery,
    ingestion: raw.ingestion,
    lineage: raw.lineage,
    scheduler: raw.scheduler,
    jdbc: raw.jdbc,
    dataDir,
  };
}
