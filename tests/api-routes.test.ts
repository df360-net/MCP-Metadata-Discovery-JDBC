import express from "express";
import request from "supertest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createApiRouter } from "../src/api-routes.js";
import { DiscoveryManager } from "../src/discovery-manager.js";
import { ConfigStore } from "../src/config-store.js";
import { mockPostgresConfig, mockMssqlConfig, mockDiscoveredDatabase } from "./fixtures/mock-data.js";
import type { AppConfig } from "../src/config.js";

const TEST_DIR = resolve(import.meta.dirname ?? ".", ".tmp-api-test");
const CONFIG_PATH = resolve(TEST_DIR, "config.json");

function makeConfig(): AppConfig {
  return {
    connectors: [mockPostgresConfig, mockMssqlConfig],
    dataDir: TEST_DIR,
  };
}

function createApp() {
  const fileConfig = {
    connectors: [mockPostgresConfig, mockMssqlConfig],
  };
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(fileConfig, null, 2));

  const config = makeConfig();
  const manager = new DiscoveryManager(config);
  const configStore = new ConfigStore(CONFIG_PATH);

  const app = express();
  app.use(express.json());
  app.use("/api", createApiRouter(manager, configStore, undefined, 8090));
  return { app, manager, configStore };
}

afterEach(() => {
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("API Routes", () => {
  describe("GET /api/connectors", () => {
    it("returns list of connectors", async () => {
      const { app } = createApp();
      const res = await request(app).get("/api/connectors");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].id).toBe("test-pg");
      expect(res.body[1].id).toBe("test-mssql");
    });
  });

  describe("GET /api/connectors/:id", () => {
    it("returns connector with masked password", async () => {
      const { app } = createApp();
      const res = await request(app).get("/api/connectors/test-pg");
      expect(res.status).toBe(200);
      expect(res.body.id).toBe("test-pg");
      expect(res.body.password).toBe("********");
      expect(res.body.host).toBe("localhost");
    });

    it("returns 404 for unknown connector", async () => {
      const { app } = createApp();
      const res = await request(app).get("/api/connectors/unknown");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/connectors", () => {
    it("adds a new connector", async () => {
      const { app } = createApp();
      const res = await request(app).post("/api/connectors").send({
        id: "new-mysql", type: "MYSQL", host: "h", port: 3306, user: "u", password: "p", database: "db",
      });
      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);

      // Verify it was added
      const list = await request(app).get("/api/connectors");
      expect(list.body).toHaveLength(3);
    });

    it("returns 400 when id is missing", async () => {
      const { app } = createApp();
      const res = await request(app).post("/api/connectors").send({ type: "MYSQL", host: "h", port: 3306, user: "u", password: "p", database: "db" });
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid port", async () => {
      const { app } = createApp();
      const res = await request(app).post("/api/connectors").send({ id: "x", type: "MYSQL", host: "h", port: 99999, user: "u", password: "p", database: "db" });
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid type", async () => {
      const { app } = createApp();
      const res = await request(app).post("/api/connectors").send({ id: "x", type: "INVALID", host: "h", port: 3306, user: "u", password: "p", database: "db" });
      expect(res.status).toBe(400);
    });

    it("returns 400 for duplicate id", async () => {
      const { app } = createApp();
      const res = await request(app).post("/api/connectors").send(mockPostgresConfig);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("already exists");
    });
  });

  describe("PUT /api/connectors/:id", () => {
    it("updates an existing connector", async () => {
      const { app } = createApp();
      const res = await request(app).put("/api/connectors/test-pg").send({ host: "new-host" });
      expect(res.status).toBe(200);

      const detail = await request(app).get("/api/connectors/test-pg");
      expect(detail.body.host).toBe("new-host");
    });

    it("returns 400 for unknown connector", async () => {
      const { app } = createApp();
      const res = await request(app).put("/api/connectors/unknown").send({ host: "h" });
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/connectors/:id", () => {
    it("deletes a connector", async () => {
      const { app } = createApp();
      const res = await request(app).delete("/api/connectors/test-mssql");
      expect(res.status).toBe(200);

      const list = await request(app).get("/api/connectors");
      expect(list.body).toHaveLength(1);
    });
  });

  describe("GET /api/connectors/:id/schema", () => {
    it("returns 404 when no cache exists", async () => {
      const { app } = createApp();
      const res = await request(app).get("/api/connectors/test-pg/schema");
      expect(res.status).toBe(404);
    });

    it("returns cached schema when available", async () => {
      mkdirSync(TEST_DIR, { recursive: true });
      const db = mockDiscoveredDatabase();
      writeFileSync(resolve(TEST_DIR, "test-pg.discovery.json"), JSON.stringify(db));

      const { app } = createApp();
      const res = await request(app).get("/api/connectors/test-pg/schema");
      expect(res.status).toBe(200);
      expect(res.body.databaseName).toBe("testdb");
    });
  });

  describe("GET /api/lineage", () => {
    it("returns lineage edges with pagination", async () => {
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(resolve(TEST_DIR, "test-pg.discovery.json"), JSON.stringify(mockDiscoveredDatabase()));

      const { app } = createApp();
      const res = await request(app).get("/api/lineage");
      expect(res.status).toBe(200);
      expect(res.body.edgeCount).toBeGreaterThan(0);
      expect(res.body.edges).toBeInstanceOf(Array);
      expect(res.body.totalCount).toBeDefined();
      expect(res.body.limit).toBeDefined();
      expect(res.body.offset).toBe(0);
    });

    it("supports connector filter", async () => {
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(resolve(TEST_DIR, "test-pg.discovery.json"), JSON.stringify(mockDiscoveredDatabase()));

      const { app } = createApp();
      const res = await request(app).get("/api/lineage?connector=test-mssql");
      expect(res.status).toBe(200);
      expect(res.body.edgeCount).toBe(0);
    });

    it("supports limit and offset", async () => {
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(resolve(TEST_DIR, "test-pg.discovery.json"), JSON.stringify(mockDiscoveredDatabase()));

      const { app } = createApp();
      const res = await request(app).get("/api/lineage?limit=1&offset=0");
      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(1);
      expect(res.body.offset).toBe(0);
      expect(res.body.edges.length).toBeLessThanOrEqual(1);
    });
  });

  describe("GET /api/lineage/summary", () => {
    it("returns lineage summary stats", async () => {
      const { app } = createApp();
      const res = await request(app).get("/api/lineage/summary");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("totalRaw");
      expect(res.body).toHaveProperty("uniqueEdges");
      expect(res.body).toHaveProperty("bySourceType");
    });
  });

  describe("GET /api/search/columns", () => {
    it("returns 400 when q is missing", async () => {
      const { app } = createApp();
      const res = await request(app).get("/api/search/columns");
      expect(res.status).toBe(400);
    });

    it("returns matching columns with pagination", async () => {
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(resolve(TEST_DIR, "test-pg.discovery.json"), JSON.stringify(mockDiscoveredDatabase()));

      const { app } = createApp();
      const res = await request(app).get("/api/search/columns?q=email");
      expect(res.status).toBe(200);
      expect(res.body.matchCount).toBeGreaterThan(0);
      expect(res.body.totalCount).toBeDefined();
      expect(res.body.results[0].column).toBe("email");
    });

    it("returns 400 for invalid regex", async () => {
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(resolve(TEST_DIR, "test-pg.discovery.json"), JSON.stringify(mockDiscoveredDatabase()));

      const { app } = createApp();
      const res = await request(app).get("/api/search/columns?q=[unclosed");
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/connectors/:id/schema?format=csv", () => {
    it("returns CSV export", async () => {
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(resolve(TEST_DIR, "test-pg.discovery.json"), JSON.stringify(mockDiscoveredDatabase()));

      const { app } = createApp();
      const res = await request(app).get("/api/connectors/test-pg/schema?format=csv");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.text).toContain("connector,schema,table,column");
      expect(res.text).toContain("email");
    });

    it("escapes CSV fields containing commas and quotes", async () => {
      mkdirSync(TEST_DIR, { recursive: true });
      // Create a db with a column that has a comma in the comment (stored in fullDataType or dataType)
      const db = mockDiscoveredDatabase({
        schemas: [{
          schemaName: "public",
          tables: [{
            tableName: "test_table",
            tableType: "TABLE" as const,
            columns: [{
              columnName: 'description,field',
              ordinalPosition: 1,
              dataType: 'varchar',
              fullDataType: 'varchar(255)',
              isNullable: true,
              isPrimaryKey: false,
              isAutoIncrement: false,
            }],
            foreignKeys: [],
            indexes: [],
          }],
          views: [],
        }],
      });
      writeFileSync(resolve(TEST_DIR, "test-pg.discovery.json"), JSON.stringify(db));

      const { app } = createApp();
      const res = await request(app).get("/api/connectors/test-pg/schema?format=csv");
      expect(res.status).toBe(200);
      // Column name with comma should be quoted
      expect(res.text).toContain('"description,field"');
    });
  });

  describe("GET /api/openapi.json", () => {
    it("returns OpenAPI spec", async () => {
      const { app } = createApp();
      const res = await request(app).get("/api/openapi.json");
      expect(res.status).toBe(200);
      expect(res.body.openapi).toBe("3.0.3");
      expect(res.body.paths).toBeDefined();
    });
  });

  describe("POST /api/admin/reload-config", () => {
    it("reloads config from file", async () => {
      const { app } = createApp();
      const res = await request(app).post("/api/admin/reload-config");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.connectors).toBe(2);
    });
  });

  describe("GET /api/ingestion/target", () => {
    it("returns default ingestion target info", async () => {
      const { app } = createApp();
      const res = await request(app).get("/api/ingestion/target");
      expect(res.status).toBe(200);
      expect(res.body.baseUrl).toContain("/api/v1/ingest");
      expect(res.body.hasApiKey).toBe(false);
    });
  });

  describe("POST /api/connectors/:id/test", () => {
    it("returns 404 for unknown connector", async () => {
      const { app } = createApp();
      const res = await request(app).post("/api/connectors/unknown/test");
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("not found");
    });
  });

  describe("POST /api/connectors/:id/discover", () => {
    it("returns 404 for unknown connector", async () => {
      const { app } = createApp();
      const res = await request(app).post("/api/connectors/unknown/discover");
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("not found");
    });
  });

  describe("POST /api/connectors/:id/push", () => {
    it("returns 404 for unknown connector", async () => {
      const { app } = createApp();
      const res = await request(app).post("/api/connectors/unknown/push");
      expect(res.status).toBe(404);
    });

    it("returns 400 when no cached discovery exists", async () => {
      const { app } = createApp();
      const res = await request(app).post("/api/connectors/test-pg/push");
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("No cached discovery");
    });
  });
});
