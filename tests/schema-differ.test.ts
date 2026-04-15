import { compareSchemas, allAddedDiff } from "../src/scheduler/schema-differ.js";
import { mockDiscoveredDatabase, mockTable, mockColumn, mockOrdersTable } from "./fixtures/mock-data.js";

describe("SchemaDiffer", () => {
  describe("compareSchemas", () => {
    it("detects no changes when databases are identical", () => {
      const db = mockDiscoveredDatabase();
      const diff = compareSchemas(db, db);
      expect(diff.hasChanges).toBe(false);
      expect(diff.summary.tablesAdded).toBe(0);
      expect(diff.summary.tablesDropped).toBe(0);
      expect(diff.summary.columnsModified).toBe(0);
    });

    it("detects a new table added", () => {
      const oldDb = mockDiscoveredDatabase();
      const newDb = mockDiscoveredDatabase({
        schemas: [{
          schemaName: "public",
          tables: [mockTable(), mockOrdersTable(), mockTable({ tableName: "new_table", columns: [mockColumn({ columnName: "id" })] })],
          views: [mockTable({ tableName: "active_users", tableType: "VIEW", columns: [mockColumn({ columnName: "user_id" })], primaryKey: undefined, foreignKeys: [], indexes: [] })],
        }],
      });
      const diff = compareSchemas(oldDb, newDb);
      expect(diff.hasChanges).toBe(true);
      expect(diff.summary.tablesAdded).toBe(1);
      const addedTable = diff.schemas[0].tables.find((t) => t.tableName === "new_table");
      expect(addedTable?.status).toBe("added");
    });

    it("detects a table dropped", () => {
      const oldDb = mockDiscoveredDatabase();
      const newDb = mockDiscoveredDatabase({
        schemas: [{
          schemaName: "public",
          tables: [mockTable()], // only users, orders dropped
          views: [mockTable({ tableName: "active_users", tableType: "VIEW", columns: [mockColumn({ columnName: "user_id" })], primaryKey: undefined, foreignKeys: [], indexes: [] })],
        }],
      });
      const diff = compareSchemas(oldDb, newDb);
      expect(diff.hasChanges).toBe(true);
      expect(diff.summary.tablesDropped).toBe(1);
      const dropped = diff.schemas[0].tables.find((t) => t.tableName === "orders");
      expect(dropped?.status).toBe("dropped");
    });

    it("detects a column added to existing table", () => {
      const oldDb = mockDiscoveredDatabase();
      const newDb = mockDiscoveredDatabase({
        schemas: [{
          schemaName: "public",
          tables: [
            mockTable({
              columns: [
                mockColumn({ columnName: "user_id", ordinalPosition: 1, isPrimaryKey: true, isAutoIncrement: true }),
                mockColumn({ columnName: "email", ordinalPosition: 2, dataType: "varchar", fullDataType: "varchar(255)", isNullable: true, isPrimaryKey: false, isAutoIncrement: false }),
                mockColumn({ columnName: "name", ordinalPosition: 3, dataType: "varchar", fullDataType: "varchar(100)", isNullable: true, isPrimaryKey: false, isAutoIncrement: false }),
                mockColumn({ columnName: "phone", ordinalPosition: 4, dataType: "varchar", fullDataType: "varchar(20)", isNullable: true, isPrimaryKey: false, isAutoIncrement: false }),
              ],
            }),
            mockOrdersTable(),
          ],
          views: [mockTable({ tableName: "active_users", tableType: "VIEW", columns: [mockColumn({ columnName: "user_id" }), mockColumn({ columnName: "email", ordinalPosition: 2, dataType: "varchar", fullDataType: "varchar(255)", isPrimaryKey: false, isAutoIncrement: false })], primaryKey: undefined, foreignKeys: [], indexes: [] })],
        }],
      });
      const diff = compareSchemas(oldDb, newDb);
      expect(diff.hasChanges).toBe(true);
      expect(diff.summary.columnsAdded).toBe(1);
      const usersTable = diff.schemas[0].tables.find((t) => t.tableName === "users");
      expect(usersTable?.status).toBe("modified");
      const phoneCol = usersTable?.columns.find((c) => c.columnName === "phone");
      expect(phoneCol?.status).toBe("added");
    });

    it("detects a column type change", () => {
      const oldDb = mockDiscoveredDatabase();
      const newDb = mockDiscoveredDatabase({
        schemas: [{
          schemaName: "public",
          tables: [
            mockTable({
              columns: [
                mockColumn({ columnName: "user_id", ordinalPosition: 1, isPrimaryKey: true, isAutoIncrement: true }),
                mockColumn({ columnName: "email", ordinalPosition: 2, dataType: "varchar", fullDataType: "varchar(500)", isNullable: true, isPrimaryKey: false, isAutoIncrement: false }), // changed from 255
                mockColumn({ columnName: "name", ordinalPosition: 3, dataType: "varchar", fullDataType: "varchar(100)", isNullable: true, isPrimaryKey: false, isAutoIncrement: false }),
              ],
            }),
            mockOrdersTable(),
          ],
          views: [mockTable({ tableName: "active_users", tableType: "VIEW", columns: [mockColumn({ columnName: "user_id" }), mockColumn({ columnName: "email", ordinalPosition: 2, dataType: "varchar", fullDataType: "varchar(255)", isPrimaryKey: false, isAutoIncrement: false })], primaryKey: undefined, foreignKeys: [], indexes: [] })],
        }],
      });
      const diff = compareSchemas(oldDb, newDb);
      expect(diff.hasChanges).toBe(true);
      expect(diff.summary.columnsModified).toBe(1);
      const usersTable = diff.schemas[0].tables.find((t) => t.tableName === "users");
      const emailCol = usersTable?.columns.find((c) => c.columnName === "email");
      expect(emailCol?.status).toBe("modified");
      expect(emailCol?.changes).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "fullDataType", oldValue: "varchar(255)", newValue: "varchar(500)" })]),
      );
    });

    it("detects a schema added", () => {
      const oldDb = mockDiscoveredDatabase();
      const newDb = mockDiscoveredDatabase({
        schemas: [
          ...oldDb.schemas,
          { schemaName: "analytics", tables: [mockTable({ tableName: "events" })], views: [] },
        ],
      });
      const diff = compareSchemas(oldDb, newDb);
      expect(diff.hasChanges).toBe(true);
      const added = diff.schemas.find((s) => s.schemaName === "analytics");
      expect(added?.status).toBe("added");
    });

    it("detects a schema dropped", () => {
      const oldDb = mockDiscoveredDatabase({
        schemas: [
          ...mockDiscoveredDatabase().schemas,
          { schemaName: "old_schema", tables: [mockTable({ tableName: "old_table" })], views: [] },
        ],
      });
      const newDb = mockDiscoveredDatabase();
      const diff = compareSchemas(oldDb, newDb);
      expect(diff.hasChanges).toBe(true);
      const dropped = diff.schemas.find((s) => s.schemaName === "old_schema");
      expect(dropped?.status).toBe("dropped");
    });

    it("detects FK added", () => {
      const oldDb = mockDiscoveredDatabase({
        schemas: [{
          schemaName: "public",
          tables: [mockTable({ foreignKeys: [] }), mockOrdersTable()],
          views: [],
        }],
      });
      const newDb = mockDiscoveredDatabase({
        schemas: [{
          schemaName: "public",
          tables: [
            mockTable({ foreignKeys: [{ constraintName: "new_fk", columns: ["ref_id"], referencedSchema: "public", referencedTable: "other", referencedColumns: ["id"] }] }),
            mockOrdersTable(),
          ],
          views: [],
        }],
      });
      const diff = compareSchemas(oldDb, newDb);
      expect(diff.hasChanges).toBe(true);
      expect(diff.summary.fkChanges).toBeGreaterThan(0);
    });
  });

  describe("allAddedDiff", () => {
    it("marks everything as added", () => {
      const db = mockDiscoveredDatabase();
      const diff = allAddedDiff(db);
      expect(diff.hasChanges).toBe(true);
      expect(diff.schemas[0].status).toBe("added");
      expect(diff.summary.tablesAdded).toBeGreaterThan(0);
      expect(diff.summary.columnsAdded).toBeGreaterThan(0);
    });
  });
});
