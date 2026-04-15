# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-04-12

### Added
- Multi-database metadata discovery (PostgreSQL, MySQL, MSSQL, Oracle, Snowflake, BigQuery, Redshift, Databricks, Dremio, Iceberg, Teradata)
- MCP protocol support with 6 tools (list_connectors, test_connection, discover_metadata, get_schema, get_lineage, search_columns)
- REST API with full CRUD for connectors, discovery, search, lineage, and ingestion
- React admin UI with connector management, schema viewer, lineage explorer, and column search
- FK lineage extraction with aggregation and deduplication
- Operational lineage from Snowflake ACCESS_HISTORY, BigQuery JOBS, Databricks system tables, Redshift SYS_QUERY_DETAIL
- Metadata ingestion client with retry logic and exponential backoff
- Mock ingestion API for local development
- PII detection heuristic for column-level flagging
- CSV export for schema column inventory
- OpenAPI 3.0.3 specification
- Zod validation on all request bodies and query parameters
- Rate limiting, CORS, request logging middleware
- Cache TTL with LRU eviction
- Concurrent discovery guard with 10-minute timeout
- Error message sanitization to prevent credential leakage
- Configurable per-query timeouts for all database connectors
- Configurable fetch timeouts for REST-based connectors
- Security headers (X-Content-Type-Options, X-Frame-Options)
- Unhandled rejection and uncaught exception handlers
- AbortController cleanup in React hooks
- Modal accessibility (ARIA attributes, Escape key via useEffect)
- CI/CD with GitHub Actions (Node 18, 20, 22)
- TypeScript declarations and source maps for npm consumers

### Security
- SQL injection prevention via parameterized queries and input escaping
- Credential sanitization in all error messages and logs
- Connector ID path parameter validation
- Regex pattern length limit (500 chars) to prevent ReDoS
- SSL certificate validation configurable for Redshift
- Config file path not exposed in error messages
