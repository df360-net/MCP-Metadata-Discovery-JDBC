import type { ConnectorConfig } from "../../src/config.js";
import type {
  DiscoveredDatabase,
  DiscoveredSchema,
  DiscoveredTable,
  DiscoveredColumn,
  RawLineageEdge,
} from "../../src/discovery/types.js";

// ---------------------------------------------------------------------------
// Mock ConnectorConfig
// ---------------------------------------------------------------------------

export const mockPostgresConfig: ConnectorConfig = {
  id: "test-pg",
  type: "POSTGRESQL",
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: "secret",
  database: "testdb",
  schemas: ["public"],
};

export const mockMssqlConfig: ConnectorConfig = {
  id: "test-mssql",
  type: "MSSQL",
  host: "localhost",
  port: 1433,
  user: "sa",
  password: "secret",
  database: "testdb",
  schemas: ["dbo"],
  encrypt: false,
  trustServerCertificate: true,
};

export const mockRedshiftConfig: ConnectorConfig = {
  id: "test-redshift",
  type: "REDSHIFT",
  host: "cluster.redshift.amazonaws.com",
  port: 5439,
  user: "admin",
  password: "secret",
  database: "dev",
  connectTimeout: 15000,
  batchSize: 100,
  queryTextSequenceLimit: 8,
  lineageLookbackHours: 48,
};

export const mockDatabricksConfig: ConnectorConfig = {
  id: "test-databricks",
  type: "DATABRICKS",
  host: "dbc-test.cloud.databricks.com",
  port: 443,
  user: "token",
  password: "dapi-test",
  database: "samples",
  warehouseId: "abc123",
  waitTimeout: "30s",
  maxPollIterations: 30,
  pollIntervalMs: 1000,
  lineageLookbackHours: 360,
};

export const mockSnowflakeConfig: ConnectorConfig = {
  id: "test-snowflake",
  type: "SNOWFLAKE",
  host: "test-account",
  port: 443,
  user: "testuser",
  password: "secret",
  database: "TESTDB",
  warehouse: "TEST_WH",
};

// ---------------------------------------------------------------------------
// Mock Columns
// ---------------------------------------------------------------------------

export function mockColumn(overrides: Partial<DiscoveredColumn> = {}): DiscoveredColumn {
  return {
    columnName: "id",
    ordinalPosition: 1,
    dataType: "int4",
    fullDataType: "int4",
    isNullable: false,
    isPrimaryKey: true,
    isAutoIncrement: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock Tables
// ---------------------------------------------------------------------------

export function mockTable(overrides: Partial<DiscoveredTable> = {}): DiscoveredTable {
  return {
    tableName: "users",
    tableType: "TABLE",
    estimatedRowCount: 1000,
    columns: [
      mockColumn({ columnName: "user_id", ordinalPosition: 1, dataType: "int4", fullDataType: "int4", isPrimaryKey: true, isAutoIncrement: true }),
      mockColumn({ columnName: "email", ordinalPosition: 2, dataType: "varchar", fullDataType: "varchar(255)", isNullable: true, isPrimaryKey: false, isAutoIncrement: false }),
      mockColumn({ columnName: "name", ordinalPosition: 3, dataType: "varchar", fullDataType: "varchar(100)", isNullable: true, isPrimaryKey: false, isAutoIncrement: false }),
    ],
    primaryKey: { constraintName: "users_pkey", columns: ["user_id"] },
    foreignKeys: [],
    indexes: [
      { indexName: "idx_users_email", columns: ["email"], isUnique: true },
    ],
    ...overrides,
  };
}

export function mockOrdersTable(): DiscoveredTable {
  return mockTable({
    tableName: "orders",
    estimatedRowCount: 5000,
    columns: [
      mockColumn({ columnName: "order_id", ordinalPosition: 1, dataType: "int4", fullDataType: "int4", isPrimaryKey: true }),
      mockColumn({ columnName: "user_id", ordinalPosition: 2, dataType: "int4", fullDataType: "int4", isPrimaryKey: false, isAutoIncrement: false, isNullable: false }),
      mockColumn({ columnName: "total", ordinalPosition: 3, dataType: "numeric", fullDataType: "numeric(10,2)", isPrimaryKey: false, isAutoIncrement: false, isNullable: true }),
      mockColumn({ columnName: "created_at", ordinalPosition: 4, dataType: "timestamp", fullDataType: "timestamp", isPrimaryKey: false, isAutoIncrement: false, isNullable: true }),
    ],
    primaryKey: { constraintName: "orders_pkey", columns: ["order_id"] },
    foreignKeys: [
      {
        constraintName: "orders_user_id_fkey",
        columns: ["user_id"],
        referencedSchema: "public",
        referencedTable: "users",
        referencedColumns: ["user_id"],
      },
    ],
    indexes: [],
  });
}

// ---------------------------------------------------------------------------
// Mock DiscoveredDatabase
// ---------------------------------------------------------------------------

export function mockDiscoveredDatabase(overrides: Partial<DiscoveredDatabase> = {}): DiscoveredDatabase {
  return {
    databaseName: "testdb",
    serverVersion: "PostgreSQL 15.2",
    databaseType: "POSTGRESQL",
    schemas: [
      {
        schemaName: "public",
        tables: [mockTable(), mockOrdersTable()],
        views: [
          mockTable({
            tableName: "active_users",
            tableType: "VIEW",
            estimatedRowCount: undefined,
            columns: [
              mockColumn({ columnName: "user_id", ordinalPosition: 1, dataType: "int4", fullDataType: "int4" }),
              mockColumn({ columnName: "email", ordinalPosition: 2, dataType: "varchar", fullDataType: "varchar(255)", isPrimaryKey: false, isAutoIncrement: false }),
            ],
            primaryKey: undefined,
            foreignKeys: [],
            indexes: [],
          }),
        ],
      },
    ],
    // Use `new Date()` so tests aren't sensitive to the 24h cache TTL.
    // Callers can override by passing { discoveredAt: <specific date> }.
    discoveredAt: new Date(),
    durationMs: 1500,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock Lineage Edges
// ---------------------------------------------------------------------------

export const mockFkEdges: RawLineageEdge[] = [
  {
    source_element_pid: "user_id@orders@public@test-pg",
    target_element_pid: "user_id@users@public@test-pg",
    source_type: "FK",
  },
];

export const mockOperationalEdges: RawLineageEdge[] = [
  {
    source_element_pid: "user_id@users@public@APP-SRC",
    target_element_pid: "customer_id@customers@analytics@APP-TGT",
    source_type: "OPERATIONAL",
    source_app_pid: "APP-SRC",
    target_app_pid: "APP-TGT",
  },
];

// ---------------------------------------------------------------------------
// Mock AppConfig
// ---------------------------------------------------------------------------

export function mockAppConfig() {
  return {
    connectors: [mockPostgresConfig, mockMssqlConfig],
    server: { port: 8090, shutdownTimeoutMs: 10000, jsonBodySizeLimit: "1mb" },
    discovery: { connectTimeoutMs: 10000 },
    ingestion: { baseUrl: "http://localhost:8090/api/v1/ingest", timeoutMs: 30000 },
    lineage: { sourceWeights: { FK: 100, OPERATIONAL: 80 } },
    dataDir: "/tmp/test-data",
  };
}
