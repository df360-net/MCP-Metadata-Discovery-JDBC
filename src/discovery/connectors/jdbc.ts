/**
 * JDBC Connector — delegates all metadata discovery to the Java JDBC sidecar service.
 *
 * Replaces 10 native database connectors (PostgreSQL, MySQL, MSSQL, Oracle, Snowflake,
 * BigQuery, Redshift, Databricks, Dremio, Teradata) with a single HTTP-based connector
 * that calls the Java service's standardized DatabaseMetaData extraction.
 */

import {
  sanitizeErrorMessage,
  type ConnectionConfig,
  type ConnectionTestResult,
  type DatabaseType,
  type DiscoveredDatabase,
  type DiscoveryConnector,
} from '../types.js';

/** Default JDBC sidecar base URL */
const DEFAULT_JDBC_BASE_URL = 'http://localhost:8091/api/jdbc';

/** Default timeout for HTTP requests to the sidecar (5 minutes) */
const DEFAULT_TIMEOUT_MS = 300_000;

// ---------------------------------------------------------------------------
// JDBC URL building — maps ConnectorConfig fields to JDBC connection strings
// ---------------------------------------------------------------------------

/**
 * Reject characters that can break out of a JDBC URL segment (`;`, `&`, `?`, `/`,
 * whitespace, quotes). Each DB driver uses these as property or path separators,
 * so allowing them in host/db/warehouse/user enables URL-injection attacks.
 */
function assertJdbcSafe(fieldName: string, value: string | undefined | null): string {
  if (value === undefined || value === null || value === '') {
    throw new Error(`JDBC config field "${fieldName}" is required`);
  }
  // Allow backslash for MSSQL named instances (e.g., "SERVER\SQLEXPRESS").
  if (!/^[A-Za-z0-9_.\-:\\]+$/.test(value)) {
    throw new Error(`JDBC config field "${fieldName}" contains disallowed characters`);
  }
  return value;
}

function assertJdbcSafeOptional(fieldName: string, value: string | undefined | null, fallback: string): string {
  if (value === undefined || value === null || value === '') return fallback;
  return assertJdbcSafe(fieldName, value);
}

function buildJdbcUrl(type: DatabaseType, config: ConnectionConfig): string {
  const host = assertJdbcSafe('host', config.host);
  const port = config.port !== undefined ? assertJdbcSafe('port', String(config.port)) : '';
  const database = type === 'BIGQUERY' || type === 'DREMIO'
    ? (config.database ?? '')
    : assertJdbcSafe('database', config.database);
  switch (type) {
    case 'POSTGRESQL':
      return `jdbc:postgresql://${host}:${port}/${database}`;

    case 'MYSQL':
      return `jdbc:mysql://${host}:${port}/${database}`;

    case 'MSSQL':
      return `jdbc:sqlserver://${host}:${port}`
        + `;databaseName=${database}`
        + `;encrypt=${config.encrypt ?? false}`
        + `;trustServerCertificate=${config.trustServerCertificate ?? true}`;

    case 'ORACLE':
      return `jdbc:oracle:thin:@//${host}:${port}/${database}`;

    case 'SNOWFLAKE': {
      const account = host.includes('.') ? host : `${host}.snowflakecomputing.com`;
      const warehouse = assertJdbcSafeOptional('warehouse', config.warehouse, 'COMPUTE_WH');
      return `jdbc:snowflake://${account}/?db=${database}`
        + `&warehouse=${warehouse}`;
    }

    case 'BIGQUERY': {
      const serviceAcctEmail = assertJdbcSafe('user', config.user);
      // BigQuery password is a filesystem path to a service-account key; allow
      // path separators but still reject JDBC-meaningful characters.
      const keyPath = config.password ?? '';
      if (/[;&?"'\s]/.test(keyPath)) {
        throw new Error('JDBC config field "password" (key path) contains disallowed characters');
      }
      return `jdbc:bigquery://googleapis.com:443`
        + `;ProjectId=${host}`
        + `;OAuthType=0`
        + `;OAuthServiceAcctEmail=${serviceAcctEmail}`
        + `;OAuthPvtKeyPath=${keyPath}`;
    }

    case 'REDSHIFT':
      return `jdbc:redshift://${host}:${port}/${database}`;

    case 'DATABRICKS': {
      const warehouseId = assertJdbcSafeOptional('warehouseId', config.warehouseId, '0');
      // Password is bound via driver Properties; do not interpolate into the URL.
      return `jdbc:databricks://${host}:${port}`
        + `;httpPath=sql/protocolv1/o/0/${warehouseId}`
        + `;AuthMech=3;UID=token`;
    }

    case 'DREMIO':
      return `jdbc:dremio:direct=${host}:${port}`;

    case 'TERADATA':
      return `jdbc:teradata://${host}/DATABASE=${database}`;

    default:
      throw new Error(`No JDBC URL template for database type: ${type}`);
  }
}

// ---------------------------------------------------------------------------
// JdbcConnector
// ---------------------------------------------------------------------------

export class JdbcConnector implements DiscoveryConnector {
  public readonly type: DatabaseType;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(type: DatabaseType, baseUrl?: string, timeoutMs?: number) {
    this.type = type;
    this.baseUrl = baseUrl ?? DEFAULT_JDBC_BASE_URL;
    this.timeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async testConnection(config: ConnectionConfig): Promise<ConnectionTestResult> {
    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.connectTimeout ?? 30_000);

    try {
      const jdbcUrl = buildJdbcUrl(this.type, config);

      const resp = await fetch(`${this.baseUrl}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jdbcUrl,
          user: this.type === 'BIGQUERY' ? undefined : config.user,
          password: this.type === 'BIGQUERY' ? undefined : config.password,
          databaseType: this.type,
          databaseName: config.database,
          timeoutMs: config.connectTimeout,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ message: resp.statusText })) as { message?: string; error?: string };
        return {
          success: false,
          errorMessage: err.message ?? err.error ?? `HTTP ${resp.status}`,
          latencyMs: Date.now() - start,
        };
      }

      const data = await resp.json() as { success: boolean; serverVersion?: string; error?: string; latencyMs: number };
      return {
        success: data.success,
        serverVersion: data.serverVersion,
        errorMessage: data.error,
        latencyMs: data.latencyMs,
      };
    } catch (err: unknown) {
      return {
        success: false,
        errorMessage: sanitizeErrorMessage(err),
        latencyMs: Date.now() - start,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async discover(config: ConnectionConfig): Promise<DiscoveredDatabase> {
    const jdbcUrl = buildJdbcUrl(this.type, config);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const resp = await fetch(`${this.baseUrl}/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jdbcUrl,
          user: this.type === 'BIGQUERY' ? undefined : config.user,
          password: this.type === 'BIGQUERY' ? undefined : config.password,
          schemas: config.schemas,
          databaseName: config.database,
          databaseType: this.type,
          timeoutMs: this.timeoutMs,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ message: resp.statusText })) as { message?: string };
        throw new Error(err.message ?? `JDBC service error: HTTP ${resp.status}`);
      }

      const data = await resp.json() as Record<string, unknown>;
      // Convert ISO string back to Date (Java sends Instant as ISO string)
      data.discoveredAt = new Date(data.discoveredAt as string);
      return data as unknown as DiscoveredDatabase;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`JDBC discovery timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async disconnect(): Promise<void> {
    // No-op: HTTP is stateless, no persistent connection to clean up
  }
}
