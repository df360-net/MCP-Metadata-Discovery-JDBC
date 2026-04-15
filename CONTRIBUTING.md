# Contributing to MCP Metadata Discovery

Thank you for your interest in contributing! Here's how to get started.

## Prerequisites

- **Node.js** 18+ (for the MCP server)
- **Java** 11 JRE+ (for the JDBC sidecar — Java 21 works, targets Java 11 bytecode)
- No global Gradle needed — the project ships with a Gradle wrapper

## Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/df360-net/MCP-Metadata-Discovery-JDBC.git
   cd MCP-Metadata-Discovery-JDBC
   ```

2. **Install Node.js dependencies**
   ```bash
   npm install
   ```

3. **Build both services**
   ```bash
   npm run build            # TypeScript + React UI
   npm run jdbc:build       # Java JDBC sidecar fat JAR
   ```

4. **Run tests**
   ```bash
   npm test
   ```

5. **Start both services** (two terminals)

   Terminal 1 — Java sidecar on port 8091:
   ```bash
   npm run jdbc:service
   ```

   Terminal 2 — Node.js server on port 8090:
   ```bash
   npm start
   ```

   Open `http://localhost:8090` for the Admin UI.

## Project Structure

```
src/                                   # Node.js MCP server
  index.ts                             # Express server, MCP transport, middleware
  api-routes.ts                        # REST API endpoints
  discovery-manager.ts                 # Discovery orchestration, caching, search
  config.ts / config-store.ts          # Configuration types and persistence
  tools.ts                             # MCP tool definitions
  discovery/
    types.ts                           # Shared discovery types
    connector-factory.ts               # Routes DB types to JdbcConnector or IcebergConnector
    lineageAggregator.ts               # FK lineage aggregation
    connectors/
      jdbc.ts                          # Delegates to Java sidecar via HTTP
      iceberg.ts                       # Iceberg REST Catalog (no JDBC driver available)
  ingestion/                           # Metadata ingestion client + mock server
  scheduler/                           # Incremental scheduled discovery + delta ingestion
  ui/src/                              # React admin UI

jdbc-service/                          # Java Spring Boot sidecar (port 8091)
  src/main/java/com/df360/jdbc/
    controller/                        # REST controller — 2 endpoints
    dto/                               # Request/response DTOs
    service/                           # DatabaseMetaData extraction + JDBC URL building
    config/ / exception/               # Spring config + error handling

tests/                                 # Jest test suites
docs/                                  # Design docs
```

## Making Changes

1. Create a feature branch from `master`
2. Make your changes
3. Run `npx tsc --noEmit` to verify TypeScript types
4. Run `npm test` to verify tests pass
5. Rebuild the Java sidecar if you changed Java code: `npm run jdbc:build`
6. Submit a pull request

## Code Style

- TypeScript strict mode is enabled
- Use parameterized queries everywhere (never interpolate user input into SQL)
- Sanitize error messages to avoid leaking credentials (see `sanitizeErrorMessage` in `types.ts` and `GlobalExceptionHandler.sanitize()` in Java)
- Add `try/finally` (or Java try-with-resources) to prevent connection / timeout leaks
- JDBC URLs and connection properties are sensitive — never log them directly

## Adding a New Database Type

For databases **with a JDBC driver:**

1. Add the driver dependency to `jdbc-service/build.gradle` (Maven Central if possible; otherwise `libs/` fileTree)
2. Add the database type to the `DatabaseType` union in `src/discovery/types.ts`
3. Add a case to `buildJdbcUrl()` in `src/discovery/connectors/jdbc.ts`
4. Add the database type to `JDBC_TYPES` in `src/discovery/connector-factory.ts`
5. Handle any database-specific quirks (excluded system schemas, catalog vs schema semantics) in `MetadataDiscoveryService.java`
6. Rebuild: `npm run jdbc:build`
7. Add it to `config.example.json` with a minimal example

For databases **without a JDBC driver** (rare — Iceberg is currently the only one):

1. Create a new connector file in `src/discovery/connectors/`
2. Implement the `DiscoveryConnector` interface from `src/discovery/types.ts`
3. Add the database type to the union and register in `connector-factory.ts`

## Reporting Issues

Please open an issue on GitHub with:
- A clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Node.js / Java versions and OS
- Redact any credentials from error messages or config snippets

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
