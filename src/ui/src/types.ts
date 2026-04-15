export interface ServerHealth {
  ok: boolean;
  server: string;
  connectors: number;
  activeSessions: number;
}

export interface ConnectorSummary {
  id: string;
  type: string;
  host: string;
  port: number;
  database: string;
  hasCachedDiscovery: boolean;
  lastDiscoveredAt?: string;
}

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

export interface DiscoveredDatabase {
  databaseName: string;
  serverVersion: string;
  databaseType: string;
  schemas: DiscoveredSchema[];
  discoveredAt: string;
  durationMs: number;
}

export interface DiscoveredSchema {
  schemaName: string;
  tables: DiscoveredTable[];
  views: DiscoveredTable[];
}

export interface DiscoveredTable {
  tableName: string;
  tableType: "TABLE" | "VIEW";
  estimatedRowCount?: number;
  tableComment?: string;
  columns: DiscoveredColumn[];
  primaryKey?: { constraintName: string; columns: string[] };
  foreignKeys: Array<{
    constraintName: string;
    columns: string[];
    referencedSchema: string;
    referencedTable: string;
    referencedColumns: string[];
  }>;
  indexes: Array<{ indexName: string; columns: string[]; isUnique: boolean }>;
}

export interface DiscoveredColumn {
  columnName: string;
  ordinalPosition: number;
  dataType: string;
  fullDataType: string;
  isNullable: boolean;
  columnDefault?: string;
  columnComment?: string;
  isPrimaryKey: boolean;
  isAutoIncrement: boolean;
}

export interface LineageEdge {
  source_element_pid: string;
  target_element_pid: string;
  source_type: string;
}

export interface LineageSummary {
  totalRaw: number;
  uniqueEdges: number;
  duplicatesRemoved: number;
  bySourceType: Record<string, number>;
  crossAppEdges: number;
}

export interface SearchResult {
  connector: string;
  schema: string;
  table: string;
  column: string;
  dataType: string;
  fullDataType: string;
}

// Supported database types: 10 via JDBC sidecar + Iceberg via REST.
// TRINO and CLICKHOUSE are planned but not yet supported.
export type DatabaseType =
  | "POSTGRESQL" | "MYSQL" | "MSSQL" | "ORACLE" | "SNOWFLAKE"
  | "BIGQUERY" | "REDSHIFT" | "DATABRICKS" | "DREMIO" | "ICEBERG" | "TERADATA";
