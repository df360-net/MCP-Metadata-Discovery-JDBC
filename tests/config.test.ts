import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.js";

const TEST_DIR = resolve(import.meta.dirname ?? ".", ".tmp-config-test");

function writeConfig(filename: string, content: object): string {
  mkdirSync(TEST_DIR, { recursive: true });
  const filePath = resolve(TEST_DIR, filename);
  writeFileSync(filePath, JSON.stringify(content, null, 2));
  return filePath;
}

afterAll(() => {
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("loadConfig", () => {
  it("loads a valid config file", () => {
    const path = writeConfig("valid.json", {
      connectors: [{ id: "test", type: "POSTGRESQL", host: "localhost", port: 5432, user: "u", password: "p", database: "db" }],
    });
    const config = loadConfig(path);
    expect(config.connectors).toHaveLength(1);
    expect(config.connectors[0].id).toBe("test");
    expect(config.connectors[0].type).toBe("POSTGRESQL");
  });

  it("throws when config file does not exist", () => {
    expect(() => loadConfig("/nonexistent/path.json")).toThrow("Config file not found");
  });

  it("throws for malformed JSON", () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const path = resolve(TEST_DIR, "bad.json");
    writeFileSync(path, "{ invalid json }");
    expect(() => loadConfig(path)).toThrow("Failed to parse config file");
  });

  it("throws when connectors array is empty", () => {
    const path = writeConfig("empty.json", { connectors: [] });
    expect(() => loadConfig(path)).toThrow("at least one connector is required");
  });

  it("throws when connector is missing id", () => {
    const path = writeConfig("no-id.json", {
      connectors: [{ type: "MYSQL", host: "h", port: 3306, user: "u", password: "p", database: "db" }],
    });
    expect(() => loadConfig(path)).toThrow("must have an 'id'");
  });

  it("throws when connector is missing type", () => {
    const path = writeConfig("no-type.json", {
      connectors: [{ id: "test", host: "h", port: 3306, user: "u", password: "p", database: "db" }],
    });
    expect(() => loadConfig(path)).toThrow("missing 'type'");
  });

  it("applies discovery.connectTimeoutMs as default for connectors", () => {
    const path = writeConfig("timeout.json", {
      connectors: [{ id: "test", type: "POSTGRESQL", host: "h", port: 5432, user: "u", password: "p", database: "db" }],
      discovery: { connectTimeoutMs: 30000 },
    });
    const config = loadConfig(path);
    expect(config.connectors[0].connectTimeout).toBe(30000);
  });

  it("connector-level connectTimeout overrides discovery default", () => {
    const path = writeConfig("override.json", {
      connectors: [{ id: "test", type: "POSTGRESQL", host: "h", port: 5432, user: "u", password: "p", database: "db", connectTimeout: 5000 }],
      discovery: { connectTimeoutMs: 30000 },
    });
    const config = loadConfig(path);
    expect(config.connectors[0].connectTimeout).toBe(5000);
  });

  it("passes through per-connector tuning fields", () => {
    const path = writeConfig("tuning.json", {
      connectors: [{
        id: "rs", type: "REDSHIFT", host: "h", port: 5439, user: "u", password: "p", database: "db",
        batchSize: 500, queryTextSequenceLimit: 32, lineageLookbackHours: 48,
      }],
    });
    const config = loadConfig(path);
    expect(config.connectors[0].batchSize).toBe(500);
    expect(config.connectors[0].queryTextSequenceLimit).toBe(32);
    expect(config.connectors[0].lineageLookbackHours).toBe(48);
  });

  it("passes through MSSQL SSL settings", () => {
    const path = writeConfig("mssql.json", {
      connectors: [{
        id: "ms", type: "MSSQL", host: "h", port: 1433, user: "u", password: "p", database: "db",
        encrypt: true, trustServerCertificate: false,
      }],
    });
    const config = loadConfig(path);
    expect(config.connectors[0].encrypt).toBe(true);
    expect(config.connectors[0].trustServerCertificate).toBe(false);
  });

  it("passes through server, ingestion, and lineage config", () => {
    const path = writeConfig("full.json", {
      connectors: [{ id: "test", type: "MYSQL", host: "h", port: 3306, user: "u", password: "p", database: "db" }],
      server: { port: 9090, shutdownTimeoutMs: 5000 },
      ingestion: { baseUrl: "http://dcf.example.com/api/v1/ingest", apiKey: "key123" },
      lineage: { sourceWeights: { FK: 200 } },
    });
    const config = loadConfig(path);
    expect(config.server?.port).toBe(9090);
    expect(config.server?.shutdownTimeoutMs).toBe(5000);
    expect(config.ingestion?.baseUrl).toBe("http://dcf.example.com/api/v1/ingest");
    expect(config.ingestion?.apiKey).toBe("key123");
    expect(config.lineage?.sourceWeights?.FK).toBe(200);
  });
});
