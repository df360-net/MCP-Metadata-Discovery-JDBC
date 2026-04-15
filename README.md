# MCP Metadata Discovery — JDBC Edition

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Model Context Protocol (MCP) server for automated database metadata discovery and data lineage extraction. This **JDBC edition** uses a Java Spring Boot sidecar service that leverages the standard `java.sql.DatabaseMetaData` API, replacing 10 native Node.js database connectors with a single unified service.

Connect to your databases, discover schemas/tables/columns, extract FK lineage, run scheduled incremental ingestion, and push metadata to any DCF-compatible target.

---

## Architecture

```
Node.js MCP Server (port 8090)           Java JDBC Service (port 8091)
  MCP tools, REST API, Admin UI            POST /api/jdbc/test
  Scheduler, Ingestion, Lineage            POST /api/jdbc/discover
         |                                        |
         |  HTTP/JSON (2 endpoints)               |  JDBC DatabaseMetaData
         +--------------------------------------->+
                                                  v
                                   PostgreSQL, MySQL, MSSQL, Oracle,
                                   Snowflake, BigQuery, Redshift,
                                   Databricks, Dremio, Teradata
```

Iceberg (a table format, not a queryable database) remains as a REST API connector in Node.js.

Full design is documented in [docs/MCP-METADATA-DISCOVERY-JDBC-DESIGN.md](docs/MCP-METADATA-DISCOVERY-JDBC-DESIGN.md).

---

## Features

- **10 databases via a single JDBC sidecar** — PostgreSQL, MySQL, MSSQL, Oracle, Snowflake, BigQuery, Redshift, Databricks, Dremio, Teradata
- **Iceberg REST Catalog** via Node.js (no JDBC driver available)
- **MCP protocol** — Expose 6 discovery tools to AI assistants via stdio or HTTP transport
- **REST API** — 30+ endpoints covering connectors CRUD, discovery, search, lineage, ingestion, scheduler, admin
- **Admin UI** — 4-page React dashboard (Connectors, Discovery, Lineage, Scheduler)
- **FK lineage extraction** — Automatic foreign-key edge discovery with weight-based aggregation
- **Scheduled incremental ingestion** — Cron-like scheduler that diffs schemas and pushes only delta changes to DCF
- **Disk-backed caching** — Discovery results persisted per-connector; survive restarts
- **Metadata ingestion** — Push to any DCF-compatible API (includes a local mock for testing)
- **PII detection** — Heuristic column-level PII flagging (email, SSN, credit card, etc.)

---

## Requirements

- **Node.js** 18 or newer
- **Java** 11 JRE or newer (Java 21 works fine; build targets Java 11 bytecode)
- **Gradle** — not required globally; the project ships with a Gradle 8.7 wrapper

---

## Quick Start

The system is two processes: a Node.js server on port 8090 and a Java sidecar on port 8091. Run them in separate terminals.

### 1. Install Node.js dependencies & build

```bash
npm install
npm run build
```

### 2. Build the Java sidecar (first time only)

```bash
npm run jdbc:build
```

This produces `jdbc-service/build/libs/jdbc-discovery-service.jar`.

> **⚠️ Three drivers need manual setup:**
> BigQuery, Databricks, and Dremio JDBC drivers are not in Maven Central. To use those databases, download the JARs and place them in `jdbc-service/libs/`:
> - **BigQuery (Simba)** — [Google JDBC drivers](https://cloud.google.com/bigquery/docs/reference/odbc-jdbc-drivers), filename pattern: `GoogleBigQueryJDBC42*.jar`
> - **Databricks** — [Databricks JDBC download](https://www.databricks.com/spark/jdbc-drivers-download), filename pattern: `DatabricksJDBC42*.jar`
> - **Dremio** — [Dremio drivers](https://www.dremio.com/drivers/), filename pattern: `dremio-jdbc-driver*.jar`
>
> Then re-run `npm run jdbc:build`. The other 7 JDBC drivers are pulled from Maven Central automatically.

### 3. Start both services

Terminal 1 (Java sidecar):

```bash
npm run jdbc:service
# → http://localhost:8091
```

Terminal 2 (Node.js server):

```bash
npm start
# → http://localhost:8090
```

Open `http://localhost:8090` for the Admin UI.

---

## Configuration

Create a `config.json` in the project root (or pass `--config <path>`). Every section except `connectors` is optional.

```json
{
  "connectors": [
    {
      "id": "my-postgres",
      "type": "POSTGRESQL",
      "host": "localhost",
      "port": 5432,
      "user": "postgres",
      "password": "secret",
      "database": "mydb",
      "schemas": ["public"]
    }
  ],
  "server": {
    "port": 8090,
    "shutdownTimeoutMs": 10000
  },
  "discovery": {
    "connectTimeoutMs": 10000,
    "cacheTtlHours": 24,
    "maxCacheEntries": 100
  },
  "jdbc": {
    "baseUrl": "http://localhost:8091/api/jdbc",
    "enabled": true,
    "timeoutMs": 300000
  },
  "ingestion": {
    "baseUrl": "http://localhost:8090/api/v1/ingest",
    "timeoutMs": 30000
  },
  "lineage": {
    "sourceWeights": { "FK": 100, "OPERATIONAL": 80, "ETL": 60, "MANUAL": 50, "SQL_PARSER": 40 }
  },
  "scheduler": {
    "enabled": true,
    "tickIntervalMs": 5000
  }
}
```

See [config.example.json](config.example.json) for a complete reference with all 11 database types.

### Supported Database Types

| Type | Mechanism | Notes |
|------|-----------|-------|
| `POSTGRESQL` | JDBC sidecar | Multi-schema discovery |
| `MYSQL` | JDBC sidecar | Single schema per connection |
| `MSSQL` | JDBC sidecar | Add `encrypt`/`trustServerCertificate` as needed |
| `ORACLE` | JDBC sidecar | Multi-schema; uses service name in URL |
| `SNOWFLAKE` | JDBC sidecar | Set `warehouse` (default: `COMPUTE_WH`) |
| `BIGQUERY` | JDBC sidecar | Service account key via `password`; manual JAR |
| `REDSHIFT` | JDBC sidecar | Redshift Serverless compatible |
| `DATABRICKS` | JDBC sidecar | Unity Catalog; PAT token as `password`; manual JAR |
| `DREMIO` | JDBC sidecar | Self-hosted via `jdbc:dremio:direct`; manual JAR |
| `TERADATA` | JDBC sidecar | Database = schema |
| `ICEBERG` | REST API (Node.js) | Iceberg REST Catalog spec |

---

## API Endpoints

### Connectors & discovery

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/connectors` | List all connectors |
| POST | `/api/connectors` | Add a connector |
| GET | `/api/connectors/:id` | Get connector (password masked) |
| PUT | `/api/connectors/:id` | Update connector |
| DELETE | `/api/connectors/:id` | Delete connector |
| POST | `/api/connectors/:id/test` | Test connection |
| POST | `/api/connectors/:id/discover` | Run metadata discovery |
| GET | `/api/connectors/:id/schema` | Get cached schema (`?format=csv` for export) |
| POST | `/api/connectors/:id/push` | Push metadata to ingestion target |
| POST | `/api/connectors/:id/push-lineage` | Push lineage only |

### Search, lineage, admin

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/lineage?connector=&table=` | Get lineage edges (paginated) |
| GET | `/api/lineage/summary` | Lineage aggregation stats |
| GET | `/api/search/columns?q=pattern` | Regex column search |
| GET | `/api/ingestion/target` | Get current ingestion target info |
| GET | `/api/openapi.json` | OpenAPI 3.0.3 spec |
| POST | `/api/admin/reload-config` | Hot-reload config from file |
| GET | `/health` | Health check with memory/cache stats |
| POST/GET/DELETE | `/mcp` | MCP protocol endpoint (stateful sessions) |

### Scheduler (incremental ingestion)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/scheduler/jobs` | List all scheduled jobs |
| POST | `/api/scheduler/jobs` | Create a job |
| GET | `/api/scheduler/jobs/:id` | Get job with latest run |
| PUT | `/api/scheduler/jobs/:id` | Update job |
| DELETE | `/api/scheduler/jobs/:id` | Delete job |
| POST | `/api/scheduler/jobs/:id/trigger` | Trigger a manual run |
| GET | `/api/scheduler/jobs/:id/runs` | List run history |
| GET | `/api/scheduler/runs/:id` | Full run with diff + ingestion audit |

Scheduler mechanics (discovery → diff → delta payload → push) are documented in [docs/How_Incremental_Metadata_Ingestion_Works.md](docs/How_Incremental_Metadata_Ingestion_Works.md).

### Mock ingestion API (local dev)

These emulate the DCF Metadata Ingestion API for local testing:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/ingest/container-with-entities` | Ingest schema + tables + columns |
| POST | `/api/v1/ingest/entity-with-elements` | Ingest a single table |
| POST | `/api/v1/ingest/lineage` | Ingest column-to-column lineage edges |

---

## MCP Tools

When connected via MCP (stdio or HTTP), the following 6 tools are exposed:

- `list_connectors` — List configured connectors
- `test_connection` — Test a database connection
- `discover_metadata` — Run full schema discovery
- `get_schema` — Retrieve cached schema (filterable by schema/table)
- `get_lineage` — Get FK lineage edges with summary stats
- `search_columns` — Regex column search across cached schemas

---

## Development

### Common commands

```bash
# Run tests
npm test
npm run test:watch

# Node.js dev server
npm run dev

# React UI dev server (hot reload, proxies /api to 8090)
npm run dev:ui
# → http://localhost:5174

# Rebuild Java sidecar after changing Java code
npm run jdbc:build

# Run stdio MCP transport (for Claude Desktop integration)
npm run start:stdio
```

### Ports

| Service | Port |
|---------|------|
| Node.js HTTP server | 8090 |
| Java JDBC sidecar | 8091 |
| Webpack dev server (dev:ui) | 5174 |

---

## Security

Check dependencies for known vulnerabilities:

```bash
npm audit
```

See [SECURITY.md](SECURITY.md) for vulnerability reporting guidelines. Credentials in `config.json` are never logged; error messages are sanitized before return.

---

## Project Structure

```
mcp-metadata-discovery-jdbc/
  src/                                 # Node.js MCP server
    index.ts                           # Express server, MCP transport, middleware
    api-routes.ts                      # REST API with Zod validation
    discovery-manager.ts               # Discovery orchestration, caching, search
    config.ts, config-store.ts         # Config loading + atomic persistence
    tools.ts                           # 6 MCP tool definitions
    discovery/
      types.ts                         # Shared discovery interfaces
      connector-factory.ts             # Routes types to JdbcConnector or IcebergConnector
      lineageAggregator.ts             # Weight-based edge aggregation
      connectors/
        jdbc.ts                        # Delegates to Java sidecar via HTTP
        iceberg.ts                     # Iceberg REST Catalog (non-JDBC)
    ingestion/                         # Payload builder, HTTP client, mock API
    scheduler/                         # Engine, store, differ, delta payload builder
    ui/src/                            # React admin UI (4 pages)

  jdbc-service/                        # Java Spring Boot sidecar (port 8091)
    build.gradle                       # Spring Boot 2.7.18 + 10 JDBC drivers
    libs/                              # Manual JARs (BigQuery, Databricks, Dremio)
    src/main/java/com/df360/jdbc/
      JdbcServiceApplication.java      # Entry point
      controller/JdbcController.java   # 2 endpoints: /test, /discover
      dto/                             # Request/response DTOs
      service/
        MetadataDiscoveryService.java  # DatabaseMetaData extraction
        JdbcUrlBuilder.java            # DatabaseType → JDBC URL (for standalone use)
      config/                          # Spring config + CORS
      exception/                       # Error handling + credential sanitization

  docs/
    MCP-METADATA-DISCOVERY-JDBC-DESIGN.md           # Full technical design
    How_Incremental_Metadata_Ingestion_Works.md     # Team-facing scheduler guide
  tests/                                            # Jest test suites
```

---

## Documentation

- **[docs/MCP-METADATA-DISCOVERY-JDBC-DESIGN.md](docs/MCP-METADATA-DISCOVERY-JDBC-DESIGN.md)** — Full technical design: architecture, Java sidecar internals, DTO shapes, JDBC URL building, database-specific quirks, error handling
- **[docs/How_Incremental_Metadata_Ingestion_Works.md](docs/How_Incremental_Metadata_Ingestion_Works.md)** — Detailed explanation of the scheduler, schema differ, delta payload builder, and PID stability contract
- **[CHANGELOG.md](CHANGELOG.md)** — Version history
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — Development setup and contribution guidelines
- **[SECURITY.md](SECURITY.md)** — Vulnerability reporting

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](LICENSE)
