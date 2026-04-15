import { createConnector, applyConnectorSettings } from "../src/discovery/connector-factory.js";
import { mockPostgresConfig } from "./fixtures/mock-data.js";

describe("Connector Factory", () => {
  describe("createConnector", () => {
    it.each([
      "POSTGRESQL", "MYSQL", "MSSQL", "ORACLE", "SNOWFLAKE",
      "BIGQUERY", "REDSHIFT", "DATABRICKS", "DREMIO", "ICEBERG", "TERADATA",
    ] as const)("creates connector for %s", (type) => {
      const connector = createConnector(type);
      expect(connector).toBeDefined();
      expect(connector.type).toBe(type);
    });

    it("throws for unsupported database type", () => {
      expect(() => createConnector("UNKNOWN" as any)).toThrow("Unsupported database type: UNKNOWN");
    });
  });

  describe("applyConnectorSettings", () => {
    // Note: Since the JDBC migration, per-connector tuning parameters (Redshift
    // batchSize, Databricks waitTimeout, etc.) are passed to the Java sidecar
    // via the HTTP request body rather than being set on a connector instance.
    // applyConnectorSettings now only handles the non-JDBC IcebergConnector.

    it("does nothing for JDBC-backed connectors", () => {
      const connector = createConnector("POSTGRESQL");
      // Should not throw even though ConnectorConfig may have JDBC-specific fields
      applyConnectorSettings(connector, mockPostgresConfig);
      expect(connector.type).toBe("POSTGRESQL");
    });
  });
});
