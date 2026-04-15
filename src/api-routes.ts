import { Router } from "express";
import { z } from "zod";
import type { DiscoveryManager } from "./discovery-manager.js";
import type { ConfigStore } from "./config-store.js";
import type { IngestionTargetConfig } from "./config.js";
import { IngestionClient } from "./ingestion/ingestion-client.js";

// ── Zod schemas for request validation ──

// Supported database types: 10 via JDBC sidecar + Iceberg via REST.
// TRINO and CLICKHOUSE are planned but not yet supported — omit from validation
// to prevent users from creating connectors that will fail at discovery time.
const DatabaseTypeEnum = z.enum([
  "POSTGRESQL", "MYSQL", "MSSQL", "ORACLE", "SNOWFLAKE",
  "BIGQUERY", "REDSHIFT", "DATABRICKS", "DREMIO", "ICEBERG", "TERADATA",
]);

const ConnectorCreateSchema = z.object({
  id: z.string().min(1, "id is required"),
  type: DatabaseTypeEnum,
  host: z.string().min(1, "host is required"),
  port: z.number().int().min(1).max(65535),
  user: z.string().min(1, "user is required"),
  password: z.string().min(1, "password is required"),
  database: z.string().min(1, "database is required"),
  schemas: z.array(z.string()).optional(),
  connectTimeout: z.number().int().positive().optional(),
  // Per-connector tuning (optional)
  lineageLookbackHours: z.number().positive().optional(),
  batchSize: z.number().int().positive().optional(),
  queryTextSequenceLimit: z.number().int().positive().optional(),
  waitTimeout: z.string().optional(),
  maxPollIterations: z.number().int().positive().optional(),
  pollIntervalMs: z.number().int().positive().optional(),
  warehouse: z.string().optional(),
  region: z.string().optional(),
  encrypt: z.boolean().optional(),
  trustServerCertificate: z.boolean().optional(),
  warehouseId: z.string().optional(),
  projectId: z.string().optional(),
  fetchTimeoutMs: z.number().int().positive().optional(),
});

const ConnectorUpdateSchema = z.object({
  host: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  user: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  database: z.string().min(1).optional(),
  schemas: z.array(z.string()).optional(),
  connectTimeout: z.number().int().positive().optional(),
  lineageLookbackHours: z.number().positive().optional(),
  batchSize: z.number().int().positive().optional(),
  queryTextSequenceLimit: z.number().int().positive().optional(),
  waitTimeout: z.string().optional(),
  maxPollIterations: z.number().int().positive().optional(),
  pollIntervalMs: z.number().int().positive().optional(),
  warehouse: z.string().optional(),
  region: z.string().optional(),
  encrypt: z.boolean().optional(),
  trustServerCertificate: z.boolean().optional(),
  warehouseId: z.string().optional(),
  projectId: z.string().optional(),
  fetchTimeoutMs: z.number().int().positive().optional(),
}).strict();

const PushOverrideSchema = z.object({
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
}).optional();

const LineageQuerySchema = z.object({
  connector: z.string().min(1).optional(),
  table: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(10000).default(1000),
  offset: z.coerce.number().int().min(0).default(0),
});

const SchemaQuerySchema = z.object({
  schema: z.string().min(1).optional(),
  table: z.string().min(1).optional(),
  format: z.enum(["json", "csv"]).optional(),
});

export function createApiRouter(manager: DiscoveryManager, configStore: ConfigStore, ingestionConfig?: IngestionTargetConfig, serverPort?: number): Router {
  const router = Router();
  const defaultIngestUrl = `http://localhost:${serverPort ?? 8090}/api/v1/ingest`;

  // ── Connector ID validation ──
  const CONNECTOR_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
  router.param("id", (_req, res, next, id) => {
    if (!CONNECTOR_ID_RE.test(id)) {
      res.status(400).json({ error: "Invalid connector ID format. Use alphanumeric characters, hyphens, underscores, and dots." });
      return;
    }
    next();
  });

  // ── Connectors CRUD ──

  // GET /api/connectors — list all
  router.get("/connectors", (_req, res) => {
    res.json(manager.listConnectors());
  });

  // GET /api/connectors/:id — get details (password masked)
  router.get("/connectors/:id", (req, res) => {
    const config = manager.getConnectorConfig(req.params.id);
    if (!config) {
      res.status(404).json({ error: `Connector '${req.params.id}' not found` });
      return;
    }
    // Mask password
    const { password, ...safe } = config;
    res.json({ ...safe, password: password ? "********" : "" });
  });

  // POST /api/connectors — add new connector
  router.post("/connectors", (req, res) => {
    try {
      const parsed = ConnectorCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
        return;
      }
      const body = parsed.data;
      manager.addConnector(body as any);

      // Persist to config.json
      const fileConfig = configStore.read();
      fileConfig.connectors.push(body as any);
      configStore.write(fileConfig);

      res.status(201).json({ ok: true, id: body.id });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // PUT /api/connectors/:id — update connector
  router.put("/connectors/:id", (req, res) => {
    try {
      const parsed = ConnectorUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
        return;
      }
      const body = parsed.data;
      manager.updateConnector(req.params.id, body);

      // Persist to config.json
      const fileConfig = configStore.read();
      const idx = fileConfig.connectors.findIndex((c) => c.id === req.params.id);
      if (idx !== -1) {
        fileConfig.connectors[idx] = { ...fileConfig.connectors[idx], ...body, id: req.params.id };
        configStore.write(fileConfig);
      }

      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // DELETE /api/connectors/:id — delete connector
  router.delete("/connectors/:id", (req, res) => {
    try {
      manager.removeConnector(req.params.id);

      // Persist to config.json
      const fileConfig = configStore.read();
      fileConfig.connectors = fileConfig.connectors.filter((c) => c.id !== req.params.id);
      configStore.write(fileConfig);

      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Discovery operations ──

  // POST /api/connectors/:id/test — test connection
  router.post("/connectors/:id/test", async (req, res) => {
    try {
      if (!manager.getConnectorConfig(req.params.id)) {
        res.status(404).json({ error: `Connector '${req.params.id}' not found` });
        return;
      }
      const result = await manager.testConnection(req.params.id);
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /api/connectors/:id/discover — trigger discovery
  router.post("/connectors/:id/discover", async (req, res) => {
    try {
      if (!manager.getConnectorConfig(req.params.id)) {
        res.status(404).json({ error: `Connector '${req.params.id}' not found` });
        return;
      }
      const summary = await manager.discoverMetadata(req.params.id);
      res.json(summary);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // GET /api/connectors/:id/schema — get cached discovery results (E6: with schema/table filter and format)
  router.get("/connectors/:id/schema", (req, res) => {
    const db = manager.getDiscoveredSchema(req.params.id);
    if (!db) {
      res.status(404).json({ error: "No cached discovery results. Run discover first." });
      return;
    }

    // E6: Optional schema and table filters (validated)
    const sqParsed = SchemaQuerySchema.safeParse(req.query);
    const schemaFilter = sqParsed.success ? sqParsed.data.schema : undefined;
    const tableFilter = sqParsed.success ? sqParsed.data.table : undefined;
    const format = sqParsed.success ? sqParsed.data.format : undefined;

    let result: any = db;
    if (schemaFilter) {
      const filtered = db.schemas.filter((s: any) => s.schemaName.toLowerCase() === schemaFilter.toLowerCase());
      if (filtered.length === 0) {
        res.status(404).json({ error: `Schema '${schemaFilter}' not found` });
        return;
      }
      if (tableFilter) {
        const tables = filtered.flatMap((s: any) => [...s.tables, ...s.views]).filter((t: any) => t.tableName.toLowerCase() === tableFilter.toLowerCase());
        result = { ...db, schemas: undefined, tables };
      } else {
        result = { ...db, schemas: filtered };
      }
    }

    // E11: CSV export for column inventory
    if (format === "csv") {
      const csvEsc = (v: string | number | boolean): string => {
        const s = String(v);
        if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };
      const rows: string[] = ["connector,schema,table,column,dataType,fullDataType,nullable,isPrimaryKey"];
      const schemas = schemaFilter ? db.schemas.filter((s: any) => s.schemaName.toLowerCase() === schemaFilter.toLowerCase()) : db.schemas;
      for (const s of schemas) {
        for (const t of [...(s as any).tables, ...(s as any).views]) {
          for (const c of t.columns) {
            rows.push([req.params.id, (s as any).schemaName, t.tableName, c.columnName, c.dataType, c.fullDataType, c.isNullable, c.isPrimaryKey].map(csvEsc).join(","));
          }
        }
      }
      const sanitizedId = req.params.id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "connector";
      const safeFilename = encodeURIComponent(`${sanitizedId}-schema.csv`);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);
      res.send(rows.join("\n"));
      return;
    }

    res.json(result);
  });

  // ── Lineage ──

  // GET /api/lineage — all lineage edges (with pagination)
  router.get("/lineage", (req, res) => {
    const lq = LineageQuerySchema.safeParse(req.query);
    const { connector, table, limit, offset } = lq.success ? lq.data : { connector: undefined, table: undefined, limit: 1000, offset: 0 };
    const allEdges = manager.getLineage(connector, table);
    const edges = allEdges.slice(offset, offset + limit);
    res.json({ totalCount: allEdges.length, edgeCount: edges.length, limit, offset, edges });
  });

  // GET /api/lineage/summary — summary stats
  router.get("/lineage/summary", (_req, res) => {
    res.json(manager.getLineageSummary());
  });

  // ── Search ──

  // GET /api/search/columns?q=...&connector=...
  const SearchColumnsQuerySchema = z.object({
    q: z.string().min(1).max(500),
    connector: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(10000).default(1000),
    offset: z.coerce.number().int().min(0).default(0),
  });

  router.get("/search/columns", (req, res) => {
    const parsed = SearchColumnsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      return;
    }
    const { q, connector, limit, offset } = parsed.data;
    try {
      const allResults = manager.searchColumns(q, connector);
      const results = allResults.slice(offset, offset + limit);
      res.json({ totalCount: allResults.length, matchCount: results.length, limit, offset, results });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Ingestion (push to DCF or local mock) ──

  // GET /api/ingestion/target — get current ingestion target info
  router.get("/ingestion/target", (_req, res) => {
    const defaultUrl = defaultIngestUrl;
    res.json({
      baseUrl: ingestionConfig?.baseUrl ?? defaultUrl,
      hasApiKey: !!ingestionConfig?.apiKey,
    });
  });

  // POST /api/connectors/:id/push — push discovered metadata to ingestion target
  router.post("/connectors/:id/push", async (req, res) => {
    try {
      const id = req.params.id;
      const connectorConfig = manager.getConnectorConfig(id);
      if (!connectorConfig) {
        res.status(404).json({ error: `Connector '${id}' not found` });
        return;
      }

      const db = manager.getDiscoveredSchema(id);
      if (!db) {
        res.status(400).json({ error: `No cached discovery for '${id}'. Run discover first.` });
        return;
      }

      // Allow overriding target via request body
      const overrideParsed = PushOverrideSchema.safeParse(req.body);
      const overrideBaseUrl = overrideParsed.success ? overrideParsed.data?.baseUrl : undefined;
      const overrideApiKey = overrideParsed.success ? overrideParsed.data?.apiKey : undefined;

      const defaultUrl = defaultIngestUrl;
      const client = new IngestionClient({
        baseUrl: overrideBaseUrl ?? ingestionConfig?.baseUrl ?? defaultUrl,
        apiKey: overrideApiKey ?? ingestionConfig?.apiKey,
        timeoutMs: ingestionConfig?.timeoutMs,
      });

      const result = await client.pushAll(id, connectorConfig.type, db);
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /api/connectors/:id/push-lineage — push only lineage edges
  router.post("/connectors/:id/push-lineage", async (req, res) => {
    try {
      const id = req.params.id;
      const connectorConfig = manager.getConnectorConfig(id);
      if (!connectorConfig) {
        res.status(404).json({ error: `Connector '${id}' not found` });
        return;
      }

      const db = manager.getDiscoveredSchema(id);
      if (!db) {
        res.status(400).json({ error: `No cached discovery for '${id}'. Run discover first.` });
        return;
      }

      const defaultUrl = defaultIngestUrl;
      const client = new IngestionClient({
        baseUrl: ingestionConfig?.baseUrl ?? defaultUrl,
        apiKey: ingestionConfig?.apiKey,
        timeoutMs: ingestionConfig?.timeoutMs,
      });

      const result = await client.pushLineage(id, connectorConfig.type, db);
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── E12: OpenAPI spec ──
  router.get("/openapi.json", (_req, res) => {
    res.json({
      openapi: "3.0.3",
      info: { title: "MCP Metadata Discovery API", version: "1.0.0", description: "REST API for database metadata discovery and data lineage" },
      paths: {
        "/api/connectors": {
          get: { summary: "List connectors", responses: { "200": { description: "Array of connector summaries" } } },
          post: { summary: "Add connector", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ConnectorCreate" } } } }, responses: { "201": { description: "Created" }, "400": { description: "Validation error" } } },
        },
        "/api/connectors/{id}": {
          get: { summary: "Get connector details", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Connector with masked password" }, "404": { description: "Not found" } } },
          put: { summary: "Update connector", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Updated" } } },
          delete: { summary: "Delete connector", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Deleted" } } },
        },
        "/api/connectors/{id}/test": { post: { summary: "Test connection", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Test result" } } } },
        "/api/connectors/{id}/discover": { post: { summary: "Run metadata discovery", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Discovery summary" } } } },
        "/api/connectors/{id}/schema": { get: { summary: "Get cached schema", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "schema", in: "query", schema: { type: "string" } }, { name: "table", in: "query", schema: { type: "string" } }, { name: "format", in: "query", schema: { type: "string", enum: ["json", "csv"] } }], responses: { "200": { description: "Schema data" }, "404": { description: "No cache" } } } },
        "/api/lineage": { get: { summary: "Get lineage edges", parameters: [{ name: "connector", in: "query", schema: { type: "string" } }, { name: "table", in: "query", schema: { type: "string" } }, { name: "limit", in: "query", schema: { type: "integer", default: 1000 } }, { name: "offset", in: "query", schema: { type: "integer", default: 0 } }], responses: { "200": { description: "Lineage edges" } } } },
        "/api/lineage/summary": { get: { summary: "Get lineage summary", responses: { "200": { description: "Summary stats" } } } },
        "/api/search/columns": { get: { summary: "Search columns by regex", parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }, { name: "connector", in: "query", schema: { type: "string" } }, { name: "limit", in: "query", schema: { type: "integer", default: 1000 } }, { name: "offset", in: "query", schema: { type: "integer", default: 0 } }], responses: { "200": { description: "Matching columns" } } } },
        "/api/ingestion/target": { get: { summary: "Get ingestion target info", responses: { "200": { description: "Target config" } } } },
        "/api/connectors/{id}/push": { post: { summary: "Push metadata to ingestion target", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Push result" } } } },
        "/api/connectors/{id}/push-lineage": { post: { summary: "Push FK lineage to ingestion target", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Lineage push result" }, "404": { description: "Connector or cache not found" } } } },
        "/api/admin/reload-config": { post: { summary: "Reload config from file", responses: { "200": { description: "Reload result" } } } },
      },
      components: {
        schemas: {
          ConnectorCreate: {
            type: "object",
            required: ["id", "type", "host", "port", "user", "password", "database"],
            properties: {
              id: { type: "string" }, type: { type: "string", enum: ["POSTGRESQL", "MYSQL", "MSSQL", "ORACLE", "SNOWFLAKE", "BIGQUERY", "REDSHIFT", "DATABRICKS", "DREMIO", "ICEBERG", "TERADATA"] },
              host: { type: "string" }, port: { type: "integer", minimum: 1, maximum: 65535 },
              user: { type: "string" }, password: { type: "string" }, database: { type: "string" },
              schemas: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    });
  });

  // ── E7: Config hot-reload ──
  router.post("/admin/reload-config", (_req, res) => {
    try {
      const fileConfig = configStore.read();
      // Sync in-memory connectors with file
      const currentIds = new Set(manager.listConnectors().map((c) => c.id));
      const fileIds = new Set(fileConfig.connectors.map((c) => c.id));

      // Remove connectors no longer in file
      for (const id of currentIds) {
        if (!fileIds.has(id)) {
          try { manager.removeConnector(id); } catch { /* ignore */ }
        }
      }

      // Add/update connectors from file
      for (const c of fileConfig.connectors) {
        if (currentIds.has(c.id)) {
          manager.updateConnector(c.id, c);
        } else {
          manager.addConnector(c as any);
        }
      }

      res.json({ ok: true, connectors: manager.listConnectors().length });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
