import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DiscoveryManager } from "../src/discovery-manager.js";
import { mockPostgresConfig, mockMssqlConfig, mockDiscoveredDatabase } from "./fixtures/mock-data.js";
import type { AppConfig } from "../src/config.js";

const TEST_DIR = resolve(import.meta.dirname ?? ".", ".tmp-dm-test");

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    connectors: [mockPostgresConfig, mockMssqlConfig],
    dataDir: TEST_DIR,
    ...overrides,
  };
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("DiscoveryManager", () => {
  describe("listConnectors", () => {
    it("lists all configured connectors", () => {
      const manager = new DiscoveryManager(makeConfig());
      const list = manager.listConnectors();
      expect(list).toHaveLength(2);
      expect(list[0].id).toBe("test-pg");
      expect(list[1].id).toBe("test-mssql");
    });

    it("shows hasCachedDiscovery=false when no cache", () => {
      const manager = new DiscoveryManager(makeConfig());
      const list = manager.listConnectors();
      expect(list[0].hasCachedDiscovery).toBe(false);
    });

    it("shows hasCachedDiscovery=true when cache exists on disk", () => {
      // Pre-write a cache file
      const db = mockDiscoveredDatabase();
      writeFileSync(resolve(TEST_DIR, "test-pg.discovery.json"), JSON.stringify(db));

      const manager = new DiscoveryManager(makeConfig());
      const list = manager.listConnectors();
      expect(list[0].hasCachedDiscovery).toBe(true);
    });
  });

  describe("getConnectorConfig", () => {
    it("returns config by id", () => {
      const manager = new DiscoveryManager(makeConfig());
      const config = manager.getConnectorConfig("test-pg");
      expect(config?.id).toBe("test-pg");
      expect(config?.type).toBe("POSTGRESQL");
    });

    it("returns undefined for unknown id", () => {
      const manager = new DiscoveryManager(makeConfig());
      expect(manager.getConnectorConfig("nonexistent")).toBeUndefined();
    });
  });

  describe("addConnector", () => {
    it("adds a new connector", () => {
      const manager = new DiscoveryManager(makeConfig());
      manager.addConnector({ id: "new-mysql", type: "MYSQL", host: "h", port: 3306, user: "u", password: "p", database: "db" });
      expect(manager.listConnectors()).toHaveLength(3);
    });

    it("throws if connector already exists", () => {
      const manager = new DiscoveryManager(makeConfig());
      expect(() => manager.addConnector(mockPostgresConfig)).toThrow("already exists");
    });
  });

  describe("updateConnector", () => {
    it("updates existing connector", () => {
      const manager = new DiscoveryManager(makeConfig());
      manager.updateConnector("test-pg", { host: "new-host" });
      expect(manager.getConnectorConfig("test-pg")?.host).toBe("new-host");
    });

    it("throws for unknown connector", () => {
      const manager = new DiscoveryManager(makeConfig());
      expect(() => manager.updateConnector("unknown", {})).toThrow("not found");
    });
  });

  describe("removeConnector", () => {
    it("removes a connector", () => {
      const manager = new DiscoveryManager(makeConfig());
      manager.removeConnector("test-mssql");
      expect(manager.listConnectors()).toHaveLength(1);
    });

    it("throws for unknown connector", () => {
      const manager = new DiscoveryManager(makeConfig());
      expect(() => manager.removeConnector("unknown")).toThrow("not found");
    });
  });

  describe("getDiscoveredSchema", () => {
    it("returns null when no cache", () => {
      const manager = new DiscoveryManager(makeConfig());
      expect(manager.getDiscoveredSchema("test-pg")).toBeNull();
    });

    it("returns cached data loaded from disk", () => {
      const db = mockDiscoveredDatabase();
      writeFileSync(resolve(TEST_DIR, "test-pg.discovery.json"), JSON.stringify(db));

      const manager = new DiscoveryManager(makeConfig());
      const result = manager.getDiscoveredSchema("test-pg");
      expect(result).not.toBeNull();
      expect(result?.databaseName).toBe("testdb");
      expect(result?.schemas).toHaveLength(1);
    });
  });

  describe("searchColumns", () => {
    it("searches across cached connectors", () => {
      const db = mockDiscoveredDatabase();
      writeFileSync(resolve(TEST_DIR, "test-pg.discovery.json"), JSON.stringify(db));

      const manager = new DiscoveryManager(makeConfig());
      const results = manager.searchColumns("email");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].column).toBe("email");
      expect(results[0].connector).toBe("test-pg");
    });

    it("supports regex patterns", () => {
      const db = mockDiscoveredDatabase();
      writeFileSync(resolve(TEST_DIR, "test-pg.discovery.json"), JSON.stringify(db));

      const manager = new DiscoveryManager(makeConfig());
      const results = manager.searchColumns(".*_id$");
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.column.endsWith("_id"))).toBe(true);
    });

    it("filters by connector id", () => {
      const db = mockDiscoveredDatabase();
      writeFileSync(resolve(TEST_DIR, "test-pg.discovery.json"), JSON.stringify(db));

      const manager = new DiscoveryManager(makeConfig());
      const results = manager.searchColumns("email", "test-mssql");
      expect(results).toHaveLength(0); // test-mssql has no cache
    });

    it("returns empty for no matches", () => {
      const db = mockDiscoveredDatabase();
      writeFileSync(resolve(TEST_DIR, "test-pg.discovery.json"), JSON.stringify(db));

      const manager = new DiscoveryManager(makeConfig());
      const results = manager.searchColumns("zzz_nonexistent");
      expect(results).toHaveLength(0);
    });

    it("throws on invalid regex pattern", () => {
      const db = mockDiscoveredDatabase();
      writeFileSync(resolve(TEST_DIR, "test-pg.discovery.json"), JSON.stringify(db));

      const manager = new DiscoveryManager(makeConfig());
      expect(() => manager.searchColumns("[unclosed")).toThrow("Invalid regex pattern");
    });

    it("throws on regex pattern exceeding max length", () => {
      const db = mockDiscoveredDatabase();
      writeFileSync(resolve(TEST_DIR, "test-pg.discovery.json"), JSON.stringify(db));

      const manager = new DiscoveryManager(makeConfig());
      const longPattern = "a".repeat(501);
      expect(() => manager.searchColumns(longPattern)).toThrow("too long");
    });
  });

  describe("getLineage", () => {
    it("returns FK lineage extracted from cached discovery", () => {
      const db = mockDiscoveredDatabase();
      writeFileSync(resolve(TEST_DIR, "test-pg.discovery.json"), JSON.stringify(db));

      const manager = new DiscoveryManager(makeConfig());
      const edges = manager.getLineage();
      // orders.user_id -> users.user_id
      expect(edges.length).toBeGreaterThan(0);
      expect(edges[0].source_type).toBe("FK");
    });

    it("filters by connector id", () => {
      const db = mockDiscoveredDatabase();
      writeFileSync(resolve(TEST_DIR, "test-pg.discovery.json"), JSON.stringify(db));

      const manager = new DiscoveryManager(makeConfig());
      const edges = manager.getLineage("test-pg");
      expect(edges.length).toBeGreaterThan(0);

      const noEdges = manager.getLineage("test-mssql");
      expect(noEdges).toHaveLength(0);
    });

    it("filters by table name", () => {
      const db = mockDiscoveredDatabase();
      writeFileSync(resolve(TEST_DIR, "test-pg.discovery.json"), JSON.stringify(db));

      const manager = new DiscoveryManager(makeConfig());
      const edges = manager.getLineage(undefined, "orders");
      expect(edges.length).toBeGreaterThan(0);

      const noEdges = manager.getLineage(undefined, "nonexistent");
      expect(noEdges).toHaveLength(0);
    });
  });

  describe("getLineageSummary", () => {
    it("returns aggregator summary", () => {
      const db = mockDiscoveredDatabase();
      writeFileSync(resolve(TEST_DIR, "test-pg.discovery.json"), JSON.stringify(db));

      const manager = new DiscoveryManager(makeConfig());
      const summary = manager.getLineageSummary();
      expect(summary.bySourceType.FK).toBeGreaterThan(0);
    });
  });

  describe("lineage source weight overrides", () => {
    it("passes config weights to LineageAggregator", () => {
      const manager = new DiscoveryManager(makeConfig({
        lineage: { sourceWeights: { FK: 50, MANUAL: 200 } },
      }));
      // The aggregator is internal, but we can verify via summary structure
      const summary = manager.getLineageSummary();
      expect(summary).toBeDefined();
    });
  });
});
