import { buildAppPid, buildContainerPid, buildEntityPid, buildElementPid } from "../src/ingestion/pid-helpers.js";

describe("PID Helpers", () => {
  describe("buildAppPid", () => {
    it("builds app PID from connector ID and DB type", () => {
      expect(buildAppPid("pg-df360", "POSTGRESQL")).toBe("APP-DISC-PG-DF360-POSTGRESQL-01");
    });

    it("normalizes connector ID to uppercase", () => {
      expect(buildAppPid("my-postgres", "POSTGRESQL")).toBe("APP-DISC-MY-POSTGRES-POSTGRESQL-01");
    });

    it("replaces non-alphanumeric characters with hyphens", () => {
      expect(buildAppPid("test_db.prod", "MYSQL")).toBe("APP-DISC-TEST-DB-PROD-MYSQL-01");
    });
  });

  describe("buildContainerPid", () => {
    it("builds container PID from schema and app PID", () => {
      expect(buildContainerPid("public", "APP-DISC-PG-01")).toBe("PUBLIC@APP-DISC-PG-01");
    });

    it("uppercases schema name", () => {
      expect(buildContainerPid("mySchema", "APP-X")).toBe("MYSCHEMA@APP-X");
    });
  });

  describe("buildEntityPid", () => {
    it("builds entity PID from table and container PID", () => {
      expect(buildEntityPid("users", "PUBLIC@APP-X")).toBe("USERS@PUBLIC@APP-X");
    });
  });

  describe("buildElementPid", () => {
    it("builds element PID from column and entity PID (uppercased)", () => {
      expect(buildElementPid("user_id", "USERS@PUBLIC@APP-X")).toBe("USER_ID@USERS@PUBLIC@APP-X");
    });

    it("uppercases column name for consistency", () => {
      expect(buildElementPid("Email", "USERS@PUBLIC@APP-X")).toBe("EMAIL@USERS@PUBLIC@APP-X");
    });
  });

  describe("full PID chain", () => {
    it("builds a complete element PID hierarchy", () => {
      const appPid = buildAppPid("pg-df360", "POSTGRESQL");
      const containerPid = buildContainerPid("public", appPid);
      const entityPid = buildEntityPid("orders", containerPid);
      const elementPid = buildElementPid("order_id", entityPid);

      expect(elementPid).toBe("ORDER_ID@ORDERS@PUBLIC@APP-DISC-PG-DF360-POSTGRESQL-01");
    });
  });
});
