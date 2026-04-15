import type { DatabaseType, DiscoveryConnector } from './types.js';
import type { ConnectorConfig } from '../config.js';
import { JdbcConnector } from './connectors/jdbc.js';
import { IcebergConnector } from './connectors/iceberg.js';

// All database types handled by the Java JDBC sidecar service
const JDBC_TYPES: Set<DatabaseType> = new Set([
  'POSTGRESQL', 'MYSQL', 'MSSQL', 'ORACLE', 'SNOWFLAKE',
  'BIGQUERY', 'REDSHIFT', 'DATABRICKS', 'DREMIO', 'TERADATA',
]);

export function createConnector(type: DatabaseType, jdbcBaseUrl?: string, jdbcTimeoutMs?: number): DiscoveryConnector {
  if (JDBC_TYPES.has(type)) {
    return new JdbcConnector(type, jdbcBaseUrl, jdbcTimeoutMs);
  }
  if (type === 'ICEBERG') {
    return new IcebergConnector();
  }
  throw new Error(`Unsupported database type: ${type}`);
}

/**
 * Apply per-connector settings from ConnectorConfig to a connector instance.
 * JdbcConnector passes all config via HTTP request body, so no settings to apply.
 * Only Iceberg (non-JDBC) needs local settings.
 */
export function applyConnectorSettings(connector: DiscoveryConnector, config: ConnectorConfig): void {
  if (connector instanceof IcebergConnector) {
    if (config.fetchTimeoutMs != null) connector.fetchTimeoutMs = config.fetchTimeoutMs;
  }
}
