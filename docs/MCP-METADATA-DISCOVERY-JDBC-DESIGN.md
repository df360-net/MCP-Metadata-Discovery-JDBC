# MCP-Metadata-Discovery JDBC Edition — Technical Design Document

**Version:** 1.0.0  
**Date:** 2026-04-14

---

## 1. Overview

This project is a fork of [MCP-Metadata-Discovery](https://github.com/df360-net/MCP-Metadata-Discovery).

**MCP-Metadata-Discovery** is a standalone MCP server for database metadata discovery and data lineage. It connects to multiple database systems, discovers their full schema metadata (tables, columns, types, constraints, foreign keys, indexes, views, comments), and extracts data lineage from foreign key relationships.

It exposes this functionality via three interfaces:
1. **MCP Tools** — for AI agents (Claude Desktop, etc.) via stdio or HTTP transport
2. **REST API** — for programmatic access and the Admin UI
3. **React Admin UI** — for humans to manage connectors, trigger discovery, view results, explore lineage, and push metadata to ingestion targets

### 1.1 JDBC Edition — What Changed

The original project has 11 separate Node.js connectors, each using a different npm driver (postgres, mysql2, mssql, oracledb, snowflake-sdk, etc.) with custom SQL against database-specific system catalogs. This edition replaces 10 of those with a **single Java JDBC sidecar service** that uses the standard `java.sql.DatabaseMetaData` interface — `getTables()`, `getColumns()`, `getPrimaryKeys()`, `getImportedKeys()`, `getIndexInfo()` — making a single connector possible.

Iceberg (a table format, not a queryable database) remains as a REST API connector in Node.js.

### 1.2 Why a Java Sidecar?

Three approaches were evaluated:

| Approach | Pros | Cons | Risk |
|----------|------|------|------|
| **Java Sidecar (chosen)** | Zero disruption to Node.js; clean separation; services independently deployable; reusable beyond MCP | Two processes to manage; extra HTTP hop | Low |
| Node.js JDBC Bridge (node-java) | Single process | Requires JDK + C++ compiler; node-gyp build issues; JNI stability risk; poor maintenance | Medium-High |
| Full Java Rewrite | One language, one runtime | Complete rewrite; loses working MCP server, React UI, Express API; massive effort | High |

**The Java Sidecar was chosen** because:
1. **Zero disruption** — Node.js MCP server, React UI, REST API, ingestion, and scheduler all stay exactly as they are
2. **Clean architecture** — each service does one thing well; they communicate via simple HTTP/JSON
3. **Low risk** — if the Java service has issues, the existing codebase still functions; migration can be done one database at a time
4. **Reusable** — the Java service isn't coupled to MCP and can serve other tools
5. **Trivial to extend** — adding a new database = drop in a JDBC driver JAR

---

## 2. Architecture

### 2.1 High-Level Design

```
+-----------------------------------------------------------------------+
|                       DUAL TRANSPORT LAYER                            |
+--------------------+--------------------------------------------------+
|  Stdio Transport   |  HTTP Stateful Transport (Express on port 8090)  |
|  (MCP via stdin/   |  +-----------+-----------+---------------------+ |
|   stdout)          |  | MCP /mcp  | REST /api | Static UI dist/ui/  | |
+--------------------+--+-----------+-----------+---------------------+-+
                              |             |
                              v             v
+-----------------------------------------------------------------------+
|           MCP TOOLS (6)   +   REST API (30+ endpoints)                 |
+------------------------------+----------------------------------------+
                               |
                               v
+-----------------------------------------------------------------------+
|                    DISCOVERY MANAGER (Orchestrator)                    |
|  - Connector CRUD          - Discovery execution & disk caching       |
|  - FK lineage extraction   - Column search (regex)                    |
|  - LineageAggregator       - In-memory + JSON file cache              |
+------------------------------+----------------------------------------+
                               |
              +----------------+------------------+
              v                                   v
+----------------------------+    +----------------------------------+
|  CONNECTOR FACTORY         |    |  INGESTION SYSTEM                |
|  JdbcConnector (10 DBs)    |    |  Payload Builder -> Client ->    |
|  IcebergConnector (REST)   |    |  Mock API or Real DCF            |
+-------------+--------------+    +----------------------------------+
              |
              | HTTP/JSON
              v
+----------------------------+
|  JAVA JDBC SIDECAR (8091)  |
|  POST /api/jdbc/test       |
|  POST /api/jdbc/discover   |
|  DatabaseMetaData API      |
|  10 JDBC driver JARs       |
+----------------------------+
              |
              v
    PostgreSQL, MySQL, MSSQL,
    Oracle, Snowflake, BigQuery,
    Redshift, Databricks,
    Dremio, Teradata
```

### 2.2 Key Design Patterns

- **Factory Pattern:** `ConnectorFactory` maps `DatabaseType` to `JdbcConnector` or `IcebergConnector`
- **Sidecar Pattern:** Java JDBC service runs alongside Node.js, communicates via HTTP/JSON
- **Adapter Pattern:** Payload builders transform discovery results to DCF ingestion format
- **PID Encoding:** Hierarchical string PIDs (`COLUMN@TABLE@SCHEMA@APP-PID`) for cross-system lineage
- **Disk Cache:** Discovery results persisted as `{connectorId}.discovery.json`, reloaded on startup
- **Pluggable Target:** Ingestion client's `baseUrl` switches between local mock and real DCF

### 2.3 Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Spring Boot 2.7.18** | Last 2.x release supporting Java 11 (work requirement) |
| **JDBC URL built on Node.js side** | Java service receives a ready-to-use URL, stays stateless and generic |
| **No connection pooling** | Discovery is infrequent; each request opens and closes its own connection |
| **`conn.setReadOnly(true)`** | Prevents accidental writes during metadata-only operations |
| **Quirks via conditional logic** | Database-specific behavior handled in `MetadataDiscoveryService` keyed on `databaseType`, not via subclassing |
| **Manual JARs in `libs/`** | BigQuery Simba, Databricks, and Dremio drivers are not in Maven Central |
| **Jackson `@JsonProperty`** | Prevents Jackson from stripping `is` prefix on boolean fields (`isPrimaryKey`, `isNullable`, etc.) |

### 2.4 Component Interaction Flows

**Discovery Flow:**
1. User triggers discovery (UI button, MCP tool, or REST call)
2. DiscoveryManager loads ConnectorConfig, creates `JdbcConnector` via factory
3. `JdbcConnector` builds JDBC URL from config, POSTs to Java sidecar
4. Java sidecar connects via JDBC, runs `DatabaseMetaData` calls, returns JSON
5. Result cached in memory and written to `data/{connectorId}.discovery.json`
6. FK lineage extracted from all foreign keys -> `RawLineageEdge[]` -> `LineageAggregator`
7. `DiscoveryRunSummary` returned to caller

**Ingestion Flow:**
1. User clicks "Push to Ingest" (or calls `POST /api/connectors/:id/push`)
2. `IngestionClient.pushAll()` invoked with cached `DiscoveredDatabase`
3. `PayloadBuilder` transforms discovery into DCF payloads (one per schema + lineage)
4. HTTP POST to ingestion target (mock at `localhost:8090` or real DCF)
5. `PushAllResult` with created/updated/failed counts returned

---

## 3. Directory Structure

```
mcp-metadata-discovery-jdbc/
  package.json                          # Dependencies + scripts
  tsconfig.json                         # TypeScript config (ES2022, Node16, strict)
  webpack.config.js                     # Webpack for React UI (dev port 5174, proxy to 8090)
  postcss.config.js                     # PostCSS config for Tailwind
  config.json                           # Runtime config (gitignored — contains credentials)
  config.example.json                   # Example config (safe to commit)

  src/
    index.ts                            # Entry point: CLI args, dual transport, Express app
    config.ts                           # Config loader: loadConfig() -> AppConfig
    config-store.ts                     # Atomic read/write for config.json
    tools.ts                            # 6 MCP tools registered via server.tool()
    api-routes.ts                       # Express router: /api/* REST endpoints
    discovery-manager.ts                # Central orchestrator: CRUD, discover, cache, lineage, search

    discovery/
      types.ts                          # All discovery interfaces (60+ types)
      connector-factory.ts              # DatabaseType -> JdbcConnector or IcebergConnector
      lineageAggregator.ts              # Edge dedup, weight-based winner selection
      connectors/
        jdbc.ts                         # JDBC connector — delegates to Java sidecar via HTTP
        iceberg.ts                      # Iceberg REST Catalog connector (no JDBC driver)

    ingestion/
      types.ts                          # DCF ingestion API types (payloads + responses)
      pid-helpers.ts                    # PID generation (APP, Container, Entity, Element)
      dtype-mapping.ts                  # Native DB types -> DCF DTYPE-* PIDs
      payload-builder.ts                # Discovery -> DCF payload transformation
      ingestion-client.ts               # Generic HTTP client (configurable baseUrl)
      mock-ingest-routes.ts             # Mock DCF API (saves to JSON files)

    scheduler/
      types.ts                          # Scheduled job, runs, diffs, audit trails
      engine.ts                         # Tick-based scheduler with delta diff/push
      store.ts                          # Persistent job storage (filesystem JSON)
      schema-differ.ts                  # Compares old vs. new discovery results
      delta-payload-builder.ts          # Builds only-changed metadata payloads
      scheduler-routes.ts               # REST API for job management

    ui/
      index.html                        # HTML shell
      src/
        main.tsx                        # React entry point
        App.tsx                         # Root component: topbar + sidebar + pages
        app.css                         # Global styles (Tailwind + custom)
        types.ts                        # UI TypeScript types
        hooks/
          useApi.ts                     # useFetch, apiPost, apiPut, apiDelete
        components/
          ConnectorsPage.tsx            # Page 1: Connector CRUD + test
          DiscoveryPage.tsx             # Page 2: Discover + schema tree + push
          LineagePage.tsx               # Page 3: Lineage table + column search
          SchedulerPage.tsx             # Page 4: Scheduled jobs management
          ConnectorFormModal.tsx         # Shared add/edit connector form
          ConfirmModal.tsx              # Generic confirmation dialog
          ErrorBoundary.tsx             # React error boundary

  jdbc-service/                         # Java JDBC Sidecar Service
    build.gradle                        # Spring Boot 2.7.18 + 10 JDBC drivers
    settings.gradle                     # Project name: jdbc-discovery-service
    gradlew / gradlew.bat              # Gradle wrapper (8.7)
    gradle/wrapper/                     # Gradle wrapper JAR + properties
    libs/                               # Manual JARs (gitignored)
    src/main/java/com/df360/jdbc/
      JdbcServiceApplication.java       # @SpringBootApplication entry point
      controller/JdbcController.java    # 2 REST endpoints
      dto/                              # Request + response DTOs (10 classes)
      service/
        MetadataDiscoveryService.java   # Core: DatabaseMetaData extraction
        JdbcUrlBuilder.java             # DatabaseType -> JDBC URL utility
      config/                           # Spring config + CORS
      exception/                        # Custom exception + global handler
    src/main/resources/
      application.yml                   # Port 8091, timeouts, logging

  tests/                                # Jest tests
  data/                                 # Runtime data (gitignored)
  build/                                # TypeScript compiled output (gitignored)
  dist/ui/                              # Webpack production build (gitignored)
```

---

## 4. Configuration

### 4.1 config.json Shape

```typescript
{
  connectors: ConnectorConfig[];        // Required: at least one connector
  server?: {
    port?: number;                      // Default: 8090
    shutdownTimeoutMs?: number;         // Default: 10000
    jsonBodySizeLimit?: string;         // Default: "1mb"
  };
  discovery?: {
    connectTimeoutMs?: number;          // Default: 10000
    cacheTtlHours?: number;            // Default: 24
    maxCacheEntries?: number;          // Default: 100
  };
  ingestion?: {
    baseUrl?: string;                   // Default: http://localhost:8090/api/v1/ingest
    apiKey?: string;                    // Bearer token for real DCF
    timeoutMs?: number;                 // Default: 30000
  };
  lineage?: {
    sourceWeights?: Record<LineageSourceKind, number>;
  };
  scheduler?: {
    enabled?: boolean;                  // Default: true
    tickIntervalMs?: number;           // Default: 5000
  };
  jdbc?: {
    baseUrl?: string;                   // Default: http://localhost:8091/api/jdbc
    enabled?: boolean;                  // Default: true
    timeoutMs?: number;                 // Default: 300000 (5 min)
  };
}
```

### 4.2 ConnectorConfig

```typescript
interface ConnectorConfig {
  id: string;                           // Unique identifier (e.g., "pg-df360")
  type: DatabaseType;                   // POSTGRESQL | MYSQL | MSSQL | ORACLE | DATABRICKS |
                                        // SNOWFLAKE | BIGQUERY | DREMIO | REDSHIFT | ICEBERG | TERADATA
  host: string;                         // Hostname or account ID
  port: number;                         // Port number
  user: string;                         // Username or service account
  password: string;                     // Password, API token, or path to key file
  database: string;                     // Database/catalog/project name
  schemas?: string[];                   // Optional schema filter
  connectTimeout?: number;              // Connection timeout in ms (default: 10000)
  warehouseId?: string;                 // Databricks SQL Warehouse ID
  projectId?: string;                   // Dremio Cloud project UUID
  warehouse?: string;                   // Snowflake warehouse name
  encrypt?: boolean;                    // MSSQL: enable encryption
  trustServerCertificate?: boolean;     // MSSQL: trust self-signed certs
  fetchTimeoutMs?: number;              // REST API fetch timeout (Iceberg)
}
```

---

## 5. Discovery Layer

### 5.1 Core Interfaces

```typescript
interface DiscoveryConnector {
  readonly type: DatabaseType;
  testConnection(config: ConnectionConfig): Promise<ConnectionTestResult>;
  discover(config: ConnectionConfig): Promise<DiscoveredDatabase>;
  disconnect(): Promise<void>;
}

interface ConnectionTestResult {
  success: boolean;
  serverVersion?: string;
  errorMessage?: string;
  latencyMs: number;
}
```

### 5.2 Discovered Metadata Hierarchy

```
DiscoveredDatabase
  +-- databaseName, serverVersion, databaseType, discoveredAt, durationMs
  +-- schemas: DiscoveredSchema[]
        +-- schemaName
        +-- tables: DiscoveredTable[]
        +-- views: DiscoveredTable[]
              +-- tableName, tableType ('TABLE' | 'VIEW')
              +-- estimatedRowCount?, tableComment?
              +-- columns: DiscoveredColumn[]
              |     +-- columnName, ordinalPosition, dataType, fullDataType
              |     +-- isNullable, columnDefault?, columnComment?
              |     +-- isPrimaryKey, isAutoIncrement
              |     +-- characterMaxLength?, numericPrecision?, numericScale?
              +-- primaryKey?: DiscoveredPrimaryKey { constraintName, columns[] }
              +-- foreignKeys: DiscoveredForeignKey[]
              |     +-- constraintName, columns[], referencedSchema, referencedTable, referencedColumns[]
              +-- indexes: DiscoveredIndex[] { indexName, columns[], isUnique }
```

### 5.3 Connectors

| Connector | Databases | Method |
|-----------|-----------|--------|
| `JdbcConnector` | PostgreSQL, MySQL, MSSQL, Oracle, Snowflake, BigQuery, Redshift, Databricks, Dremio, Teradata | HTTP to Java sidecar → JDBC `DatabaseMetaData` |
| `IcebergConnector` | Iceberg REST Catalog | Direct REST API (no JDBC driver available) |

### 5.4 Connector Factory

```typescript
const JDBC_TYPES: Set<DatabaseType> = new Set([
  'POSTGRESQL', 'MYSQL', 'MSSQL', 'ORACLE', 'SNOWFLAKE',
  'BIGQUERY', 'REDSHIFT', 'DATABRICKS', 'DREMIO', 'TERADATA',
]);

export function createConnector(type: DatabaseType, jdbcBaseUrl?, jdbcTimeoutMs?): DiscoveryConnector {
  if (JDBC_TYPES.has(type)) return new JdbcConnector(type, jdbcBaseUrl, jdbcTimeoutMs);
  if (type === 'ICEBERG') return new IcebergConnector();
  throw new Error(`Unsupported database type: ${type}`);
}
```

### 5.5 JDBC URL Building

The `JdbcConnector` builds JDBC URLs from `ConnectorConfig` fields before sending to the Java sidecar:

| Database Type | JDBC URL Pattern |
|---------------|------------------|
| POSTGRESQL | `jdbc:postgresql://host:port/database` |
| MYSQL | `jdbc:mysql://host:port/database` |
| MSSQL | `jdbc:sqlserver://host:port;databaseName=database;encrypt=false;trustServerCertificate=true` |
| ORACLE | `jdbc:oracle:thin:@//host:port/database` |
| SNOWFLAKE | `jdbc:snowflake://account.snowflakecomputing.com/?db=database&warehouse=WH` |
| BIGQUERY | `jdbc:bigquery://googleapis.com:443;ProjectId=host;OAuthType=0;OAuthServiceAcctEmail=user;OAuthPvtKeyPath=password` |
| REDSHIFT | `jdbc:redshift://host:port/database` |
| DATABRICKS | `jdbc:databricks://host:port;httpPath=sql/protocolv1/o/0/warehouseId;AuthMech=3;UID=token;PWD=password` |
| DREMIO | `jdbc:dremio:direct=host:port` |
| TERADATA | `jdbc:teradata://host/DATABASE=database` |

### 5.6 Lineage Aggregator

```typescript
class LineageAggregator {
  addEdges(edges: RawLineageEdge[]): void;        // Dedup by source+target+sourceType
  getAllEdges(): RawLineageEdge[];                  // All unique edges
  getWinnerEdges(): RawLineageEdge[];              // One per source+target (highest weight)
  getEdgesByApp(): Map<string, RawLineageEdge[]>;  // Grouped by application PID
  getSummary(): LineageAggregatorSummary;           // Stats
  clear(): void;
}
```

**Source Type Weights:** FK=100, OPERATIONAL=80, ETL=60, MANUAL=50, SQL_PARSER=40

Only the `FK` source type is currently populated — emitted by the JDBC sidecar discovery. The other source types (OPERATIONAL, ETL, SQL_PARSER, MANUAL) are reserved for future providers that would feed into the same `LineageAggregator`.

---

## 6. Java JDBC Sidecar Service

### 6.1 Project Structure

```
jdbc-service/
  build.gradle                              # Spring Boot 2.7.18 + 10 JDBC drivers
  settings.gradle                           # Project name: jdbc-discovery-service
  gradlew / gradlew.bat                     # Gradle 8.7 wrapper
  libs/                                     # Manual JARs (gitignored)
    GoogleBigQueryJDBC42.jar                # BigQuery Simba driver
    DatabricksJDBC42.jar                    # Databricks driver
    dremio-jdbc-driver.jar                  # Dremio driver
  src/main/java/com/df360/jdbc/
    JdbcServiceApplication.java             # @SpringBootApplication entry point
    controller/
      JdbcController.java                   # REST controller (2 endpoints)
    dto/
      JdbcRequest.java                      # Request DTO
      TestConnectionResponse.java           # Response for /test
      DiscoveredDatabaseDto.java            # Response for /discover (+ Schema, Table, Column, PK, FK, Index DTOs)
      ErrorResponse.java                    # Standardized error envelope
    service/
      MetadataDiscoveryService.java         # Core service using DatabaseMetaData
      JdbcUrlBuilder.java                   # Static utility for standalone testing
    config/
      JdbcServiceConfig.java               # @ConfigurationProperties for timeouts, limits
      WebConfig.java                        # CORS config (allow port 8090)
    exception/
      JdbcDiscoveryException.java          # Custom runtime exception
      GlobalExceptionHandler.java          # @ControllerAdvice — error sanitization
  src/main/resources/
    application.yml                         # Port 8091, Jackson, logging
```

### 6.2 Gradle Build

```groovy
plugins {
    id 'java'
    id 'org.springframework.boot' version '2.7.18'
    id 'io.spring.dependency-management' version '1.1.4'
}

java {
    sourceCompatibility = JavaVersion.VERSION_11
    targetCompatibility = JavaVersion.VERSION_11
}

dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-web'
    implementation 'org.springframework.boot:spring-boot-starter-actuator'
    implementation 'com.fasterxml.jackson.datatype:jackson-datatype-jsr310'

    // 10 JDBC Drivers
    runtimeOnly 'org.postgresql:postgresql:42.7.3'
    runtimeOnly 'com.mysql:mysql-connector-j:8.3.0'
    runtimeOnly 'com.microsoft.sqlserver:mssql-jdbc:12.6.1.jre11'
    runtimeOnly 'com.oracle.database.jdbc:ojdbc11:23.3.0.23.09'
    runtimeOnly 'net.snowflake:snowflake-jdbc:3.16.1'
    runtimeOnly 'com.amazon.redshift:redshift-jdbc42:2.1.0.29'
    runtimeOnly 'com.teradata.jdbc:terajdbc:20.00.00.16'
    runtimeOnly fileTree(dir: 'libs', include: ['GoogleBigQueryJDBC42*.jar'])   // BigQuery Simba
    runtimeOnly fileTree(dir: 'libs', include: ['DatabricksJDBC42*.jar'])       // Databricks
    runtimeOnly fileTree(dir: 'libs', include: ['dremio-jdbc-driver*.jar'])     // Dremio
}
```

### 6.3 Driver Availability

| Driver | Source | Notes |
|--------|--------|-------|
| PostgreSQL | Maven Central | Standard |
| MySQL | Maven Central | Standard |
| MSSQL | Maven Central | Use `jre11` classifier |
| Oracle | Maven Central | `ojdbc11` supports Java 11+ |
| Snowflake | Maven Central | Standard |
| BigQuery (Simba) | **Manual download** | ~150MB, from [Google JDBC drivers page](https://cloud.google.com/bigquery/docs/reference/odbc-jdbc-drivers) |
| Redshift | Maven Central | Standard |
| Databricks | **Manual download** | From [Databricks JDBC download](https://www.databricks.com/spark/jdbc-drivers-download) |
| Dremio | **Manual download** | From [Dremio drivers page](https://www.dremio.com/drivers/) |
| Teradata | Teradata Maven repo | `teradata-presto.s3.amazonaws.com/jdbc4/` |

> ⚠️ **Important: Three drivers must be downloaded manually**
>
> BigQuery, Databricks, and Dremio JDBC drivers are **not available in Maven Central** (licensing/distribution restrictions). Without these JARs, you'll see errors like `"No suitable driver found for jdbc:dremio"` when trying to connect.
>
> **Setup steps:**
> 1. Download each driver from the vendor link in the table above (license acceptance may be required)
> 2. Place the JAR files in `jdbc-service/libs/`
> 3. Filenames must match the `fileTree` patterns in `build.gradle`:
>    - BigQuery: `GoogleBigQueryJDBC42*.jar`
>    - Databricks: `DatabricksJDBC42*.jar`
>    - Dremio: `dremio-jdbc-driver*.jar`
> 4. Rebuild the sidecar: `npm run jdbc:build`
> 5. Restart: `npm run jdbc:service`
>
> The `libs/` folder is gitignored — these proprietary JARs are never committed to the repo. Each developer or deployment environment must add them locally.
>
> **Notes on Dremio Cloud:** Dremio Cloud uses Arrow Flight SQL rather than traditional JDBC. The URL pattern differs from self-hosted Dremio Software:
> - Dremio Software: `jdbc:dremio:direct=host:port`
> - Dremio Cloud: `jdbc:arrow-flight-sql://data.dremio.cloud:443/?useEncryption=true&token=<PAT>`
>
> The `JdbcConnector` currently implements the Software pattern. Cloud support may require a different URL template.

### 6.4 REST Endpoints

| Method | Path | Purpose | Request | Response |
|--------|------|---------|---------|----------|
| `POST` | `/api/jdbc/test` | Test database connection | `JdbcRequest` | `TestConnectionResponse` |
| `POST` | `/api/jdbc/discover` | Full metadata discovery | `JdbcRequest` | `DiscoveredDatabaseDto` |

**`JdbcRequest`:** `{ jdbcUrl, user, password, schemas?, databaseName, databaseType, properties?, timeoutMs? }`

**`TestConnectionResponse`:** `{ success, serverVersion?, latencyMs, error? }`

**`DiscoveredDatabaseDto`:** Matches TypeScript `DiscoveredDatabase` exactly (same hierarchy as section 5.2)

### 6.5 Core Service — `MetadataDiscoveryService`

Uses `java.sql.DatabaseMetaData` for standardized metadata extraction:

- **`testConnection()`** — `DriverManager.getConnection()` + `meta.getDatabaseProductName()`
- **`discover()`** — resolves schemas, then per-schema:
  - `meta.getTables(catalog, schema, "%", ["TABLE", "VIEW"])`
  - `meta.getColumns(catalog, schema, table, "%")`
  - `meta.getPrimaryKeys(catalog, schema, table)`
  - `meta.getImportedKeys(catalog, schema, table)` (foreign keys)
  - `meta.getIndexInfo(catalog, schema, table, false, false)`

**Catalog vs. Schema parameter mapping:**

| Database | `catalog` param | `schemaPattern` param |
|----------|-----------------|----------------------|
| PostgreSQL | databaseName | schemaName |
| MySQL | databaseName | null (no schema layer) |
| MSSQL | databaseName | schemaName |
| Oracle | null | schemaName (= owner) |
| Snowflake | databaseName | schemaName |
| BigQuery | projectId | datasetName |
| Redshift | databaseName | schemaName |
| Databricks | catalogName | schemaName |
| Dremio | null | schemaName |
| Teradata | null | databaseName |

### 6.6 Database-Specific Quirks

| Database | Quirk | Handling |
|----------|-------|----------|
| **Oracle** | `getSchemas()` returns all users as schemas | Filtered via excluded system schema list |
| **MySQL** | No schema layer — "database" = schema | `resolveSchemas()` returns `[databaseName]` |
| **BigQuery** | No FKs or indexes | `getImportedKeys()` / `getIndexInfo()` return empty |
| **Databricks** | Unity Catalog hierarchy | catalog = catalog name; token auth |
| **Dremio** | No constraints/indexes | PK/FK/Index calls return empty |
| **Teradata** | "database" = schema | Fallback to `getCatalogs()` |
| **MSSQL** | Newer drivers default to encrypted | `encrypt=false;trustServerCertificate=true` in URL |

#### Foreign Key Referenced Schema Resolution

When `getImportedKeys()` returns the referenced table's schema, different databases populate different columns:

- Most databases populate `PKTABLE_SCHEM`
- **MySQL** leaves `PKTABLE_SCHEM` null and puts the referenced database in `PKTABLE_CAT` (because MySQL "schemas" are JDBC catalogs)

`MetadataDiscoveryService.discoverForeignKeys()` resolves the referenced schema in this order:

1. `PKTABLE_SCHEM` (most databases)
2. `PKTABLE_CAT` (MySQL fallback)
3. `fallbackSchema` — the current schema of the source table (last resort)

**Why this matters:** PIDs include the schema segment (`COLUMN@TABLE@SCHEMA@APP`). If the target PID has an empty schema (`CITY_ID@CITY@@APP-...`) while the source has one (`CITY_ID@ADDRESS@SAKILA@APP-...`), the FK lineage edges cannot be reconciled downstream. The fallback chain keeps source and target PIDs consistent across all databases.

### 6.7 Error Handling & Timeouts

**Timeout layers:**

| Layer | Mechanism | Default |
|-------|-----------|---------|
| JDBC connection | `DriverManager.setLoginTimeout()` | 10s |
| Statement/query | `statement.setQueryTimeout()` | 300s |
| HTTP (Tomcat) | `server.tomcat.connection-timeout` | 300s |
| Node.js → Java | `AbortController` in `fetch()` | 5 min |

**Error sanitization:** `GlobalExceptionHandler` strips passwords, tokens, and connection strings from error messages before returning.

---

## 7. Discovery Manager

**File:** `src/discovery-manager.ts`

### 7.1 Public API

```typescript
class DiscoveryManager {
  // Connector CRUD
  listConnectors(): ConnectorSummary[];
  getConnectorConfig(id: string): ConnectorConfig | undefined;
  addConnector(config: ConnectorConfig): void;
  updateConnector(id: string, partial: Partial<ConnectorConfig>): void;
  removeConnector(id: string): void;

  // Discovery
  testConnection(id: string): Promise<ConnectionTestResult>;
  discoverMetadata(id: string): Promise<DiscoveryRunSummary>;
  getDiscoveredSchema(id: string): DiscoveredDatabase | null;

  // Lineage
  getLineage(connectorId?: string, table?: string): RawLineageEdge[];
  getLineageSummary(): LineageAggregatorSummary;

  // Search
  searchColumns(pattern: string, connectorId?: string): SearchResult[];

  // Lifecycle
  close(): Promise<void>;
}
```

### 7.2 Caching Strategy

- **In-Memory:** `Map<connectorId, DiscoveredDatabase>` — fast reads
- **Disk:** `data/{connectorId}.discovery.json` — survives restarts
- **TTL:** Configurable (default 24 hours), eviction on access or size limit
- **Startup:** Constructor loads all cached files from disk
- **On Discovery:** Result saved to both memory and disk immediately

### 7.3 FK Lineage Extraction

After each discovery, all foreign keys are walked to produce `RawLineageEdge` objects:

```
source_element_pid: {fk_column}@{table}@{schema}@{connectorId}
target_element_pid: {ref_column}@{ref_table}@{ref_schema}@{connectorId}
source_type: "FK"
```

---

## 8. MCP Tools

**File:** `src/tools.ts` — 6 tools registered via `server.tool()` with Zod schemas.

| # | Tool Name | Input | Output | Purpose |
|---|-----------|-------|--------|---------|
| 1 | `list_connectors` | `{}` | `ConnectorSummary[]` | List all connectors with status |
| 2 | `test_connection` | `{ connector: string }` | `ConnectionTestResult` | Test connectivity |
| 3 | `discover_metadata` | `{ connector: string }` | `DiscoveryRunSummary` | Run full discovery |
| 4 | `get_schema` | `{ connector, schema?, table? }` | Filtered metadata tree | Get cached discovery results |
| 5 | `get_lineage` | `{ connector?, table? }` | `{ summary, edgeCount, edges }` | Get lineage edges |
| 6 | `search_columns` | `{ pattern, connector? }` | `{ matchCount, results }` | Regex column search |

---

## 9. REST API

**File:** `src/api-routes.ts` — Express router mounted at `/api`.

### 9.1 Connector CRUD

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/connectors` | List all connectors |
| `GET` | `/api/connectors/:id` | Get connector details (password masked) |
| `POST` | `/api/connectors` | Add new connector |
| `PUT` | `/api/connectors/:id` | Update connector |
| `DELETE` | `/api/connectors/:id` | Delete connector |

### 9.2 Discovery Operations

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/connectors/:id/test` | Test connection |
| `POST` | `/api/connectors/:id/discover` | Run metadata discovery |
| `GET` | `/api/connectors/:id/schema` | Get cached discovery results |

### 9.3 Lineage & Search

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/lineage?connector=&table=` | Get lineage edges (filtered) |
| `GET` | `/api/lineage/summary` | Lineage aggregation stats |
| `GET` | `/api/search/columns?q=&connector=` | Regex column search |

### 9.4 Ingestion

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/ingestion/target` | Get current ingestion target info |
| `POST` | `/api/connectors/:id/push` | Push all metadata + lineage to ingestion target |
| `POST` | `/api/connectors/:id/push-lineage` | Push lineage only |

### 9.5 Mock Ingestion API

Mounted at `/api/v1/ingest` — mimics DCF Metadata Ingestion REST API:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/v1/ingest/container-with-entities` | Ingest database/schema + tables + columns |
| `POST` | `/api/v1/ingest/entity-with-elements` | Ingest single table into existing container |
| `POST` | `/api/v1/ingest/lineage` | Ingest column-to-column lineage edges |

### 9.6 Scheduler

**File:** [`src/scheduler/scheduler-routes.ts`](../src/scheduler/scheduler-routes.ts) — mounted at `/api/scheduler`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/scheduler/jobs` | List all scheduled jobs (with `latestRun` summary) |
| `GET` | `/api/scheduler/jobs/:id` | Get single job + latest run |
| `POST` | `/api/scheduler/jobs` | Create a new scheduled job |
| `PUT` | `/api/scheduler/jobs/:id` | Update job (recalculates `nextRunAt` if schedule changed) |
| `DELETE` | `/api/scheduler/jobs/:id` | Delete a job |
| `POST` | `/api/scheduler/jobs/:id/trigger` | Manually trigger a job run (`triggeredBy = MANUAL`) |
| `GET` | `/api/scheduler/jobs/:id/runs` | List run history for a job (paginated) |
| `GET` | `/api/scheduler/runs/:id` | Get a single run with full audit (diff + ingestion result) |

See [How_Incremental_Metadata_Ingestion_Works.md](./How_Incremental_Metadata_Ingestion_Works.md) for the scheduler's execution flow, diffing logic, and delta payload construction.

### 9.7 Other

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Health check (connectors count, active sessions) |
| `GET` | `/api/openapi.json` | OpenAPI 3.0.3 spec |
| `POST` | `/api/admin/reload-config` | Hot-reload config from file |
| `POST/GET/DELETE` | `/mcp` | MCP protocol endpoint (stateful sessions) |

---

## 10. Ingestion System

### 10.1 Three-Layer Architecture

```
  DiscoveredDatabase
         |
         v
  +-- Payload Builder --+   Transforms discovery -> DCF payloads
  |  pid-helpers.ts     |   Generates hierarchical PIDs
  |  dtype-mapping.ts   |   Maps native types -> DTYPE-* PIDs
  +----------+----------+
             |
             v
  +-- Ingestion Client -+   Generic HTTP client
  |  Configurable URL   |   Local mock or real DCF
  |  Bearer auth        |   pushAll(), pushLineage()
  +----------+----------+
             |
      +------+------+
      |             |
      v             v
  Mock API     Real DCF
  (JSON files) (PostgreSQL)
```

### 10.2 PID Generation

```
Application:  APP-DISC-{ALIAS}-{DBTYPE}-01
              e.g., APP-DISC-PG-DF360-POSTGRESQL-01

Container:    {SCHEMA}@{APP_PID}
              e.g., DF360@APP-DISC-PG-DF360-POSTGRESQL-01

Entity:       {TABLE}@{CONTAINER_PID}
              e.g., ORDERS@DF360@APP-DISC-PG-DF360-POSTGRESQL-01

Element:      {COLUMN}@{ENTITY_PID}
              e.g., ORDER_ID@ORDERS@DF360@APP-DISC-PG-DF360-POSTGRESQL-01
```

### 10.3 Data Type Mapping

**File:** [`src/ingestion/dtype-mapping.ts`](../src/ingestion/dtype-mapping.ts)

| Native Type(s) | DCF PID |
|----------------|---------|
| int, bigint, smallint, tinyint, serial, int64 | `DTYPE-INTEGER` |
| numeric, decimal, float, double, real, number | `DTYPE-NUMERIC` |
| varchar, nvarchar, string, character varying | `DTYPE-VARCHAR` |
| char, nchar, bpchar | `DTYPE-CHAR` |
| text, clob, longtext | `DTYPE-TEXT` |
| boolean, bool, bit | `DTYPE-BOOLEAN` |
| date | `DTYPE-DATE` |
| datetime, timestamp, timestamptz | `DTYPE-TIMESTAMP` |
| binary, varbinary, blob, bytea | `DTYPE-BINARY` |
| json, jsonb, xml, variant, struct, uuid | `DTYPE-VARCHAR` |

#### Type Name Normalization

Different databases return type names with precision, length, and modifiers. `mapDataType()` normalizes the input before lookup:

1. **Lowercase** the type name
2. **Strip parenthesized size** — `varchar(45)` → `varchar`, `decimal(10,2)` → `decimal`
3. **Strip DB-specific modifiers** via regex `\b(unsigned|signed|zerofill|identity)\b`:
   - MySQL: `smallint unsigned` → `smallint`, `int unsigned zerofill` → `int`
   - MSSQL: `tinyint identity` → `tinyint`
4. **Collapse whitespace**

| Raw type returned by driver | Normalized | DCF PID |
|----------------------------|-----------|---------|
| `smallint unsigned` | `smallint` | `DTYPE-INTEGER` |
| `int unsigned` | `int` | `DTYPE-INTEGER` |
| `tinyint identity` | `tinyint` | `DTYPE-INTEGER` |
| `varchar(255)` | `varchar` | `DTYPE-VARCHAR` |
| `decimal(10,2)` | `decimal` | `DTYPE-NUMERIC` |

Unknown types fall back to `DTYPE-VARCHAR`.

**Extending:** to handle a new modifier, append it to the regex in `dtype-mapping.ts`:
```typescript
.replace(/\b(unsigned|signed|zerofill|identity|YOUR_NEW_MODIFIER)\b/g, "")
```

### 10.4 Switching Ingestion Target

**At home (default):** No `ingestion` config needed — defaults to local mock at `http://localhost:8090/api/v1/ingest`

**At work:** Add to `config.json`:
```json
{
  "ingestion": {
    "baseUrl": "https://your-ingestion-api.example.com/api/v1/ingest",
    "apiKey": "your-api-key-here"
  }
}
```

---

## 11. Admin UI

**Framework:** React 19 + Tailwind CSS 4 + TypeScript  
**Build:** Webpack 5 + Babel  
**Dev Server:** Port 5174 (proxies /api to 8090)  
**Production:** Static files served from `dist/ui/`  
**Navigation:** Hash-based routing (`#connectors`, `#discovery`, `#lineage`, `#scheduler`)

### 11.1 Page 1: Connectors

- Card list of all connectors (type badge, host:port/database)
- **Add Connector** button -> modal form (DB types, auto-fill port)
- **Test** / **Edit** / **Remove** buttons

### 11.2 Page 2: Discovery

- Card per connector showing discovery status
- **Discover** button -> runs discovery, shows summary stats
- **View Schema** button -> expandable tree (schema > table > columns with PK/FK badges)
- **Push to Ingest** button -> pushes to ingestion target

### 11.3 Page 3: Lineage

- **Stats bar:** Total raw edges, unique edges, duplicates, cross-app, by source type
- **Filters:** Connector dropdown + table name filter
- **Lineage table:** Source -> Target + source type badge
- **Column Search:** Regex pattern input with results table

### 11.4 Page 4: Scheduler

- Create/manage scheduled discovery jobs (interval or daily)
- View run history with diff summaries
- Auto-push delta changes to ingestion target

---

## 12. Build & Run

### 12.1 npm Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `npm start` | `node build/index.js --http --port 8090` | Production HTTP server |
| `npm run start:stdio` | `node build/index.js --stdio` | Stdio MCP transport |
| `npm run build` | `tsc && npm run build:ui` | Full build (server + UI) |
| `npm run build:ui` | `webpack --mode production` | UI production bundle only |
| `npm run dev` | `tsc && node build/index.js --http --port 8090` | Node.js dev server |
| `npm run dev:ui` | `webpack serve --mode development` | React dev server (port 5174) |
| `npm test` | `jest` | Run unit tests |
| `npm run test:watch` | `jest --watch` | Jest in watch mode |
| `npm run jdbc:build` | `cd jdbc-service && gradlew.bat bootJar` | Build the Java sidecar fat JAR |
| `npm run jdbc:service` | `java -jar jdbc-service/build/libs/jdbc-discovery-service.jar` | Run the Java sidecar on port 8091 |

### 12.2 Java Sidecar

```bash
# Build
cd jdbc-service && ./gradlew bootJar

# Run
java -jar jdbc-service/build/libs/jdbc-discovery-service.jar
```

### 12.3 CLI Flags

```
node build/index.js [--stdio | --http] [--port PORT] [--config PATH]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--stdio` | — | Use stdio transport |
| `--http` | (default) | Use HTTP transport |
| `--port` | 8090 | HTTP server port |
| `--config` | `config.json` | Config file path |

### 12.4 Ports

| Service | Port | Description |
|---------|------|-------------|
| Node.js HTTP Server | 8090 | REST API + MCP + Health + Static UI |
| Java JDBC Sidecar | 8091 | JDBC metadata discovery |
| Webpack Dev Server | 5174 | React dev server (proxies /api to 8090) |

---

## 13. Dependencies

### 13.1 Node.js Runtime

| Package | Version | Purpose |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | 1.10.1 | MCP server (tools, transports) |
| `express` | 4.21.2 | HTTP server + REST API |
| `cors` | 2.8.6 | Cross-origin resource sharing |
| `express-rate-limit` | 8.3.2 | Rate limiting |
| `zod` | 3.24.3 | MCP tool input validation |

### 13.2 Node.js Dev

| Package | Purpose |
|---------|---------|
| `typescript` 5.3.3 | TypeScript compiler |
| `react` 19.1.0 + `react-dom` 19.1.0 | UI framework |
| `tailwindcss` 4.2.2 | CSS framework |
| `webpack` 5.90.3 + `webpack-cli` + `webpack-dev-server` | Bundler |
| `jest` 30 + `ts-jest` 29 | Testing |

### 13.3 Java Sidecar

| Component | Version | Purpose |
|-----------|---------|---------|
| Spring Boot | 2.7.18 | Web framework |
| Java target | 11 | Work requirement (local: Java 21) |
| Gradle | 8.7 (wrapper) | Build tool |
| 10 JDBC drivers | Various | Database connectivity |

---

## 14. Summary

| Aspect | Details |
|--------|---------|
| **Language** | TypeScript (Node.js) + Java (JDBC sidecar) |
| **Runtime** | Node.js 18+ and JRE 11+ |
| **Transport** | Dual MCP (stdio + HTTP stateful) + REST API |
| **UI** | React 19 SPA, 4 pages, Tailwind CSS |
| **Databases** | 10 via JDBC sidecar + 1 REST (Iceberg) |
| **Metadata** | Schemas, tables, columns, PKs, FKs, indexes |
| **Lineage** | FK-based (all connectors) via LineageAggregator |
| **Ingestion** | Generic client -> pluggable target (local mock or real DCF) |
| **Caching** | In-memory + disk JSON (per-connector), TTL-based |
| **Config** | Single `config.json` (connectors + server + discovery + ingestion + jdbc) |
| **Ports** | 8090 (Node.js), 8091 (Java sidecar), 5174 (dev UI) |
| **PID Scheme** | `COLUMN@TABLE@SCHEMA@APP-DISC-{ALIAS}-{DBTYPE}-01` |
| **MCP Tools** | 6 (list, test, discover, get_schema, get_lineage, search_columns) |
| **REST Endpoints** | 30+ (connector CRUD + discovery + lineage + search + ingestion + mock ingest + scheduler + admin) |
| **Environment** | Java 11 target, Gradle wrapper, no global installs needed |
