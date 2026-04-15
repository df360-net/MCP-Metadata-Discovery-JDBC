import { buildContainerPayloads, buildEntityPayload, buildLineagePayload } from "../src/ingestion/payload-builder.js";
import { mockDiscoveredDatabase, mockTable, mockOrdersTable, mockColumn } from "./fixtures/mock-data.js";

describe("Payload Builder", () => {
  const db = mockDiscoveredDatabase();

  describe("buildContainerPayloads", () => {
    it("returns one payload per schema", () => {
      const payloads = buildContainerPayloads("test-pg", "POSTGRESQL", db);
      expect(payloads).toHaveLength(1); // one schema: "public"
    });

    it("sets correct application PID", () => {
      const payloads = buildContainerPayloads("test-pg", "POSTGRESQL", db);
      expect(payloads[0].application_pid).toBe("APP-DISC-TEST-PG-POSTGRESQL-01");
    });

    it("sets correct container PID and name", () => {
      const payloads = buildContainerPayloads("test-pg", "POSTGRESQL", db);
      expect(payloads[0].container.data_container_pid).toBe("PUBLIC@APP-DISC-TEST-PG-POSTGRESQL-01");
      expect(payloads[0].container.data_container_name).toBe("public");
      expect(payloads[0].container.container_type_pid).toBe("TYP-RDBMS");
      expect(payloads[0].container.is_active).toBe("Y");
    });

    it("includes tables and views as entities", () => {
      const payloads = buildContainerPayloads("test-pg", "POSTGRESQL", db);
      // 2 tables (users, orders) + 1 view (active_users)
      expect(payloads[0].entities).toHaveLength(3);
    });

    it("sets correct entity type PIDs", () => {
      const payloads = buildContainerPayloads("test-pg", "POSTGRESQL", db);
      const entities = payloads[0].entities;

      // Tables get ENT-TYP-TBL
      expect(entities[0].entity.entity_type_pid).toBe("ENT-TYP-TBL");
      // Views get ENT-TYP-VW
      expect(entities[2].entity.entity_type_pid).toBe("ENT-TYP-VW");
    });

    it("maps columns to elements with correct data type PIDs", () => {
      const payloads = buildContainerPayloads("test-pg", "POSTGRESQL", db);
      const usersElements = payloads[0].entities[0].elements;

      expect(usersElements[0].data_element_name).toBe("user_id");
      expect(usersElements[0].data_type_pid).toBe("DTYPE-INTEGER");
      expect(usersElements[0].position).toBe(1);
      expect(usersElements[0].is_active).toBe("Y");
      expect(usersElements[0].pii_indicator).toBe("N");
    });

    it("detects PII columns (email, password, ssn, phone)", () => {
      const piiDb = mockDiscoveredDatabase({
        schemas: [{
          schemaName: "public",
          tables: [mockTable({
            columns: [
              mockColumn({ columnName: "email", ordinalPosition: 1, dataType: "varchar", isPrimaryKey: false, isAutoIncrement: false }),
              mockColumn({ columnName: "password_hash", ordinalPosition: 2, dataType: "varchar", isPrimaryKey: false, isAutoIncrement: false }),
              mockColumn({ columnName: "ssn", ordinalPosition: 3, dataType: "varchar", isPrimaryKey: false, isAutoIncrement: false }),
              mockColumn({ columnName: "phone_number", ordinalPosition: 4, dataType: "varchar", isPrimaryKey: false, isAutoIncrement: false }),
              mockColumn({ columnName: "credit_card", ordinalPosition: 5, dataType: "varchar", isPrimaryKey: false, isAutoIncrement: false }),
              mockColumn({ columnName: "first_name", ordinalPosition: 6, dataType: "varchar", isPrimaryKey: false, isAutoIncrement: false }),
              mockColumn({ columnName: "created_at", ordinalPosition: 7, dataType: "timestamp", isPrimaryKey: false, isAutoIncrement: false }),
            ],
            foreignKeys: [],
          })],
          views: [],
        }],
      });
      const payloads = buildContainerPayloads("test-pg", "POSTGRESQL", piiDb);
      const elements = payloads[0].entities[0].elements;

      expect(elements.find((e) => e.data_element_name === "email")?.pii_indicator).toBe("Y");
      expect(elements.find((e) => e.data_element_name === "password_hash")?.pii_indicator).toBe("Y");
      expect(elements.find((e) => e.data_element_name === "ssn")?.pii_indicator).toBe("Y");
      expect(elements.find((e) => e.data_element_name === "phone_number")?.pii_indicator).toBe("Y");
      expect(elements.find((e) => e.data_element_name === "credit_card")?.pii_indicator).toBe("Y");
      // Non-PII columns
      expect(elements.find((e) => e.data_element_name === "first_name")?.pii_indicator).toBe("N");
      expect(elements.find((e) => e.data_element_name === "created_at")?.pii_indicator).toBe("N");
    });

    it("includes PK and FK flags in element description", () => {
      const payloads = buildContainerPayloads("test-pg", "POSTGRESQL", db);
      const usersElements = payloads[0].entities[0].elements;

      // user_id is PK + AUTO_INCREMENT
      expect(usersElements[0].data_element_description).toContain("PK");
      expect(usersElements[0].data_element_description).toContain("AUTO_INCREMENT");
    });

    it("marks FK columns in element description", () => {
      const payloads = buildContainerPayloads("test-pg", "POSTGRESQL", db);
      // orders table is entity[1], user_id column (FK to users)
      const ordersElements = payloads[0].entities[1].elements;
      const userIdElement = ordersElements.find((e) => e.data_element_name === "user_id");
      expect(userIdElement?.data_element_description).toContain("FK");
    });
  });

  describe("buildEntityPayload", () => {
    it("builds payload for a single table", () => {
      const table = mockTable();
      const payload = buildEntityPayload("test-pg", "POSTGRESQL", "public", table);

      expect(payload.container_pid).toBe("PUBLIC@APP-DISC-TEST-PG-POSTGRESQL-01");
      expect(payload.entity.data_entity_name).toBe("users");
      expect(payload.entity.entity_type_pid).toBe("ENT-TYP-TBL");
      expect(payload.elements).toHaveLength(3); // 3 columns
    });

    it("includes row count in entity description", () => {
      const table = mockTable({ estimatedRowCount: 50000 });
      const payload = buildEntityPayload("test-pg", "POSTGRESQL", "public", table);
      expect(payload.entity.data_entity_description).toContain("50,000 rows");
    });
  });

  describe("buildLineagePayload", () => {
    it("extracts FK edges from discovered database", () => {
      const payload = buildLineagePayload("test-pg", "POSTGRESQL", db);

      expect(payload.application_pid).toBe("APP-DISC-TEST-PG-POSTGRESQL-01");
      expect(payload.lineage_source).toBe("FK");
      // orders.user_id -> users.user_id (one FK)
      expect(payload.edges).toHaveLength(1);
    });

    it("builds correct source and target element PIDs for FK edges", () => {
      const payload = buildLineagePayload("test-pg", "POSTGRESQL", db);
      const edge = payload.edges[0];

      expect(edge.source_element_pid).toContain("USER_ID");
      expect(edge.source_element_pid).toContain("ORDERS");
      expect(edge.target_element_pid).toContain("USER_ID");
      expect(edge.target_element_pid).toContain("USERS");
    });

    it("skips FKs with mismatched column/referencedColumns lengths", () => {
      const dbBadFk = mockDiscoveredDatabase({
        schemas: [{
          schemaName: "public",
          tables: [mockTable({
            foreignKeys: [{
              constraintName: "bad_fk",
              columns: ["a", "b"],
              referencedSchema: "public",
              referencedTable: "other",
              referencedColumns: ["x"], // mismatch!
            }],
          })],
          views: [],
        }],
      });
      const payload = buildLineagePayload("test-pg", "POSTGRESQL", dbBadFk);
      expect(payload.edges).toHaveLength(0);
    });

    it("returns empty edges when no FKs exist", () => {
      const dbNoFks = mockDiscoveredDatabase({
        schemas: [{
          schemaName: "public",
          tables: [mockTable({ foreignKeys: [] })],
          views: [],
        }],
      });
      const payload = buildLineagePayload("test-pg", "POSTGRESQL", dbNoFks);
      expect(payload.edges).toHaveLength(0);
    });
  });
});
