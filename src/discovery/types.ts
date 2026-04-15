/**
 * DF360 Metadata Discovery — Shared Types
 *
 * Types for database metadata crawling and catalog reconciliation.
 * All connectors (MySQL, MSSQL, PostgreSQL, Oracle, Databricks) return these
 * common types, regardless of the source database engine.
 */

// ---------------------------------------------------------------------------
// Connector interface — every database connector implements this
// ---------------------------------------------------------------------------

export interface DiscoveryConnector {
  /** Unique connector type identifier */
  readonly type: DatabaseType;

  /** Test connectivity and return server version */
  testConnection(config: ConnectionConfig): Promise<ConnectionTestResult>;

  /** Discover all metadata from the target database */
  discover(config: ConnectionConfig): Promise<DiscoveredDatabase>;

  /** Clean up connection resources */
  disconnect(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Connection configuration
// ---------------------------------------------------------------------------

/**
 * Supported database types: 10 via JDBC sidecar + Iceberg via REST.
 * TRINO and CLICKHOUSE are planned but not yet supported.
 */
export type DatabaseType = 'MYSQL' | 'MSSQL' | 'POSTGRESQL' | 'ORACLE' | 'DATABRICKS' | 'SNOWFLAKE' | 'BIGQUERY' | 'DREMIO' | 'REDSHIFT' | 'ICEBERG' | 'TERADATA';

export interface ConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /** For three-tier databases (PostgreSQL, MSSQL, Oracle): which schemas to discover.
   *  If omitted, discovers all non-system schemas. */
  schemas?: string[];
  /** Connection timeout in milliseconds (default: 10000) */
  connectTimeout?: number;
  /** SQL warehouse ID (Databricks — required for operational lineage via SQL Statement API) */
  warehouseId?: string;
  /** Dremio Cloud project UUID (required for Dremio Cloud API) */
  projectId?: string;
  /** Snowflake warehouse name (default: "COMPUTE_WH") */
  warehouse?: string;
  /** BigQuery region for INFORMATION_SCHEMA queries (default: "region-us") */
  region?: string;
  /** MSSQL: enable encryption (default: false) */
  encrypt?: boolean;
  /** MSSQL: trust self-signed certificates (default: true) */
  trustServerCertificate?: boolean;
  /** SSL: reject unauthorized certificates (default: false for Redshift compatibility) */
  sslRejectUnauthorized?: boolean;
  /** REST API fetch timeout in milliseconds (default: 60000). Applies to Databricks, Dremio, Iceberg. */
  fetchTimeoutMs?: number;
}

export interface ConnectionTestResult {
  success: boolean;
  serverVersion?: string;
  errorMessage?: string;
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Discovered metadata — hierarchical structure matching DF360 catalog
// ---------------------------------------------------------------------------

/** Top-level: represents a database (maps to DF360 dataContainer) */
export interface DiscoveredDatabase {
  databaseName: string;
  serverVersion: string;
  databaseType: DatabaseType;
  schemas: DiscoveredSchema[];
  discoveredAt: Date;
  durationMs: number;
}

/** Schema within a database (e.g., MySQL database, MSSQL schema) */
export interface DiscoveredSchema {
  schemaName: string;
  tables: DiscoveredTable[];
  views: DiscoveredTable[];
}

/** Table or view (maps to DF360 dataEntity) */
export interface DiscoveredTable {
  tableName: string;
  tableType: 'TABLE' | 'VIEW';
  /** Estimated row count (from INFORMATION_SCHEMA.TABLES) */
  estimatedRowCount?: number;
  tableComment?: string;
  columns: DiscoveredColumn[];
  primaryKey?: DiscoveredPrimaryKey;
  foreignKeys: DiscoveredForeignKey[];
  indexes: DiscoveredIndex[];
  /** Storage size in bytes (BigQuery, Snowflake) */
  sizeBytes?: number;
  /** DDL statement that created this table (BigQuery views, materialized views) */
  ddl?: string;
  /** BigQuery labels (key-value metadata tags) */
  labels?: Record<string, string>;
  /** Partitioning info (BigQuery: time/range partitioning) */
  partitioning?: DiscoveredPartitionInfo;
  /** Clustering columns in order (BigQuery) */
  clusteringColumns?: string[];
  /** Detailed table subtype: BASE TABLE, EXTERNAL, MATERIALIZED VIEW, CLONE, SNAPSHOT */
  detailedTableType?: string;
  /** Whether this is a sharded table (table_YYYYMMDD pattern) */
  isShardedTable?: boolean;
  /** For sharded tables: the base table name without the date suffix */
  shardedTableBase?: string;
  /** For snapshots: the base table this snapshot was taken from */
  snapshotBaseTable?: string;
}

/** Column (maps to DF360 dataElement) */
export interface DiscoveredColumn {
  columnName: string;
  ordinalPosition: number;
  dataType: string;
  /** Full type with precision, e.g., "varchar(255)", "decimal(10,2)" */
  fullDataType: string;
  isNullable: boolean;
  columnDefault?: string;
  characterMaxLength?: number;
  numericPrecision?: number;
  numericScale?: number;
  columnComment?: string;
  isPrimaryKey: boolean;
  /** Auto-increment / serial */
  isAutoIncrement: boolean;
  /** Nested field path for STRUCT types (BigQuery), e.g., "address.city" */
  fieldPath?: string;
  /** Whether this column is the partition column (BigQuery) */
  isPartitionColumn?: boolean;
  /** Position in clustering key (1-based), undefined if not a clustering column */
  clusteringPosition?: number;
}

/** Partitioning metadata (BigQuery time/range partitioning) */
export interface DiscoveredPartitionInfo {
  /** Partition column name (or "_PARTITIONTIME" for ingestion-time) */
  field: string;
  /** Partition type: DAY, HOUR, MONTH, YEAR, RANGE */
  type: string;
  /** Number of partitions (from INFORMATION_SCHEMA.PARTITIONS) */
  numPartitions?: number;
  /** Partition expiration in milliseconds */
  expirationMs?: number;
  /** Whether queries must include a partition filter */
  requirePartitionFilter?: boolean;
}

/** Primary key constraint */
export interface DiscoveredPrimaryKey {
  constraintName: string;
  columns: string[];
}

/** Foreign key relationship (potential lineage edge) */
export interface DiscoveredForeignKey {
  constraintName: string;
  columns: string[];
  referencedSchema: string;
  referencedTable: string;
  referencedColumns: string[];
}

/** Index metadata */
export interface DiscoveredIndex {
  indexName: string;
  columns: string[];
  isUnique: boolean;
}

// ---------------------------------------------------------------------------
// Discovery run tracking
// ---------------------------------------------------------------------------

export interface DiscoveryRunSummary {
  schemasFound: number;
  tablesFound: number;
  viewsFound: number;
  columnsFound: number;
  foreignKeysFound: number;
  indexesFound: number;
  durationMs: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Hybrid Lineage — raw edges tagged with source type
// ---------------------------------------------------------------------------

/** Lineage source type identifiers (match lineage_source_type PID values) */
export type LineageSourceKind = 'FK' | 'OPERATIONAL' | 'ETL' | 'SQL_PARSER' | 'MANUAL';

/**
 * A raw lineage edge emitted by any lineage provider (FK extraction,
 * operational log analysis, ETL metadata, SQL parser, manual entry).
 *
 * Uses element PIDs — resolution to numeric IDs happens at ingestion time.
 */
export interface RawLineageEdge {
  /** PID of the source (upstream) data element */
  source_element_pid: string;
  /** PID of the target (downstream) data element */
  target_element_pid: string;
  /** Which lineage provider produced this edge */
  source_type: LineageSourceKind;
  /** Application PID the source element belongs to */
  source_app_pid?: string;
  /** Application PID the target element belongs to */
  target_app_pid?: string;
}

/** Summary statistics from the LineageAggregator */
export interface LineageAggregatorSummary {
  /** Total raw edges received (before dedup) */
  totalRaw: number;
  /** Unique edges after dedup (same source+target keeps highest-weight source) */
  uniqueEdges: number;
  /** Edges removed as duplicates */
  duplicatesRemoved: number;
  /** Breakdown by source type */
  bySourceType: Record<LineageSourceKind, number>;
  /** Number of cross-application edges */
  crossAppEdges: number;
}

// ---------------------------------------------------------------------------
// Error sanitization — strip credentials from error messages
// ---------------------------------------------------------------------------

const SENSITIVE_PATTERNS = [
  /password[=:]\s*\S+/gi,
  /pwd[=:]\s*\S+/gi,
  /secret[=:]\s*\S+/gi,
  /token[=:]\s*\S+/gi,
  /api[_-]?key[=:]\s*\S+/gi,
  /apikey[=:]\s*\S+/gi,
  /authorization[=:]\s*\S+/gi,
  /bearer\s+[A-Za-z0-9._~+/=-]*/gi,
  /:[^@\s]+@/g, // user:password@host patterns (password may contain ':' or '/')
];

/** Sanitize error messages to prevent credential leakage in logs */
export function sanitizeErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  let sanitized = msg;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match) => {
      // For user:pass@host, keep structure but mask the password
      if (match.includes("@")) return ":*****@";
      // For "Bearer <token>"
      if (/^bearer\s+/i.test(match)) return "Bearer *****";
      // For key=value / key: value, mask the value
      const sep = match.includes("=") ? "=" : ":";
      const key = match.split(/[=:]/)[0];
      return `${key}${sep}*****`;
    });
  }
  return sanitized;
}
