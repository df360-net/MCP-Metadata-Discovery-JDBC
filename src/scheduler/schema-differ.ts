/**
 * Schema Differ — compares two DiscoveredDatabase objects and produces a structured SchemaDiff.
 */

import type {
  DiscoveredDatabase,
  DiscoveredSchema,
  DiscoveredTable,
  DiscoveredColumn,
  DiscoveredPrimaryKey,
  DiscoveredForeignKey,
  DiscoveredIndex,
} from "../discovery/types.js";
import type {
  SchemaDiff,
  DiffSummary,
  SchemaDiffEntry,
  TableDiffEntry,
  ColumnDiffEntry,
  ColumnChange,
  PkChange,
  FkChange,
  IndexChange,
} from "./types.js";

/**
 * Compare two discovered databases and produce a structured diff.
 *
 * Accepts null for oldDb (first-run scenario) and routes to allAddedDiff.
 * This mirrors the caller's intent in engine.ts and protects against
 * unexpected null propagation from cache misses or corrupted snapshots.
 */
export function compareSchemas(oldDb: DiscoveredDatabase | null | undefined, newDb: DiscoveredDatabase): SchemaDiff {
  if (!oldDb) {
    return allAddedDiff(newDb);
  }

  const oldMap = new Map(oldDb.schemas.map((s) => [s.schemaName, s]));
  const newMap = new Map(newDb.schemas.map((s) => [s.schemaName, s]));

  const schemas: SchemaDiffEntry[] = [];

  // Schemas in new
  for (const [name, newSchema] of newMap) {
    const oldSchema = oldMap.get(name);
    if (!oldSchema) {
      // Entire schema is new
      schemas.push({
        schemaName: name,
        status: "added",
        tables: allTables(newSchema).map((t) => tableAdded(t)),
      });
    } else {
      const entry = compareSchema(oldSchema, newSchema);
      schemas.push(entry);
    }
  }

  // Schemas dropped (in old but not in new)
  for (const [name, oldSchema] of oldMap) {
    if (!newMap.has(name)) {
      schemas.push({
        schemaName: name,
        status: "dropped",
        tables: allTables(oldSchema).map((t) => tableDropped(t)),
      });
    }
  }

  const summary = buildSummary(schemas);
  return {
    hasChanges: summary.tablesAdded + summary.tablesDropped + summary.tablesModified +
      summary.columnsAdded + summary.columnsDropped + summary.columnsModified +
      summary.pkChanges + summary.fkChanges + summary.indexChanges > 0,
    summary,
    schemas,
  };
}

/** Build a SchemaDiff representing an entirely new database (first run). */
export function allAddedDiff(db: DiscoveredDatabase): SchemaDiff {
  const schemas: SchemaDiffEntry[] = db.schemas.map((s) => ({
    schemaName: s.schemaName,
    status: "added" as const,
    tables: allTables(s).map((t) => tableAdded(t)),
  }));
  const summary = buildSummary(schemas);
  return { hasChanges: summary.tablesAdded > 0 || summary.columnsAdded > 0, summary, schemas };
}

// ---------------------------------------------------------------------------
// Private — Schema comparison
// ---------------------------------------------------------------------------

function allTables(schema: DiscoveredSchema): DiscoveredTable[] {
  return [...schema.tables, ...schema.views];
}

function compareSchema(oldSchema: DiscoveredSchema, newSchema: DiscoveredSchema): SchemaDiffEntry {
  const oldTableMap = new Map(allTables(oldSchema).map((t) => [t.tableName, t]));
  const newTableMap = new Map(allTables(newSchema).map((t) => [t.tableName, t]));

  const tables: TableDiffEntry[] = [];

  for (const [name, newTable] of newTableMap) {
    const oldTable = oldTableMap.get(name);
    if (!oldTable) {
      tables.push(tableAdded(newTable));
    } else {
      tables.push(compareTable(oldTable, newTable));
    }
  }

  for (const [name, oldTable] of oldTableMap) {
    if (!newTableMap.has(name)) {
      tables.push(tableDropped(oldTable));
    }
  }

  const hasChanges = tables.some((t) => t.status !== "unchanged");
  return {
    schemaName: newSchema.schemaName,
    status: hasChanges ? "modified" : "unchanged",
    tables,
  };
}

// ---------------------------------------------------------------------------
// Private — Table comparison
// ---------------------------------------------------------------------------

function tableAdded(table: DiscoveredTable): TableDiffEntry {
  return {
    tableName: table.tableName,
    tableType: table.tableType,
    status: "added",
    columns: table.columns.map((c) => ({ columnName: c.columnName, status: "added" as const })),
    fkChanges: table.foreignKeys.map((fk) => ({ constraintName: fk.constraintName, type: "added" as const })),
    indexChanges: table.indexes.map((idx) => ({ indexName: idx.indexName, type: "added" as const })),
    pkChange: table.primaryKey ? { type: "added" as const, newColumns: table.primaryKey.columns } : undefined,
  };
}

function tableDropped(table: DiscoveredTable): TableDiffEntry {
  return {
    tableName: table.tableName,
    tableType: table.tableType,
    status: "dropped",
    columns: table.columns.map((c) => ({ columnName: c.columnName, status: "dropped" as const })),
    fkChanges: table.foreignKeys.map((fk) => ({ constraintName: fk.constraintName, type: "dropped" as const })),
    indexChanges: table.indexes.map((idx) => ({ indexName: idx.indexName, type: "dropped" as const })),
    pkChange: table.primaryKey ? { type: "dropped" as const, oldColumns: table.primaryKey.columns } : undefined,
  };
}

function compareTable(oldTable: DiscoveredTable, newTable: DiscoveredTable): TableDiffEntry {
  const columns = compareColumns(oldTable.columns, newTable.columns);
  const pkChange = comparePk(oldTable.primaryKey, newTable.primaryKey);
  const fkChanges = compareFks(oldTable.foreignKeys, newTable.foreignKeys);
  const indexChanges = compareIndexes(oldTable.indexes, newTable.indexes);

  const hasChanges =
    columns.some((c) => c.status !== "unchanged") ||
    pkChange !== undefined ||
    fkChanges.length > 0 ||
    indexChanges.length > 0;

  return {
    tableName: newTable.tableName,
    tableType: newTable.tableType,
    status: hasChanges ? "modified" : "unchanged",
    columns,
    pkChange,
    fkChanges,
    indexChanges,
  };
}

// ---------------------------------------------------------------------------
// Private — Column comparison
// ---------------------------------------------------------------------------

const COLUMN_FIELDS: Array<keyof DiscoveredColumn> = [
  "dataType", "fullDataType", "isNullable", "columnDefault", "ordinalPosition",
  "characterMaxLength", "numericPrecision", "numericScale", "isPrimaryKey",
  "isAutoIncrement", "columnComment",
];

function compareColumns(oldCols: DiscoveredColumn[], newCols: DiscoveredColumn[]): ColumnDiffEntry[] {
  const oldMap = new Map(oldCols.map((c) => [c.columnName, c]));
  const newMap = new Map(newCols.map((c) => [c.columnName, c]));
  const result: ColumnDiffEntry[] = [];

  for (const [name, newCol] of newMap) {
    const oldCol = oldMap.get(name);
    if (!oldCol) {
      result.push({ columnName: name, status: "added" });
    } else {
      const changes = diffColumnFields(oldCol, newCol);
      result.push(changes.length > 0
        ? { columnName: name, status: "modified", changes }
        : { columnName: name, status: "unchanged" },
      );
    }
  }

  for (const name of oldMap.keys()) {
    if (!newMap.has(name)) {
      result.push({ columnName: name, status: "dropped" });
    }
  }

  return result;
}

function diffColumnFields(oldCol: DiscoveredColumn, newCol: DiscoveredColumn): ColumnChange[] {
  const changes: ColumnChange[] = [];
  for (const field of COLUMN_FIELDS) {
    const oldVal = oldCol[field];
    const newVal = newCol[field];
    // Treat undefined and null as equivalent
    if (normalize(oldVal) !== normalize(newVal)) {
      changes.push({ field, oldValue: oldVal, newValue: newVal });
    }
  }
  return changes;
}

function normalize(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

// ---------------------------------------------------------------------------
// Private — PK / FK / Index comparison
// ---------------------------------------------------------------------------

function comparePk(oldPk?: DiscoveredPrimaryKey, newPk?: DiscoveredPrimaryKey): PkChange | undefined {
  if (!oldPk && !newPk) return undefined;
  if (!oldPk && newPk) return { type: "added", newColumns: newPk.columns };
  if (oldPk && !newPk) return { type: "dropped", oldColumns: oldPk.columns };
  // Both exist — compare sorted column lists
  const oldSorted = [...oldPk!.columns].sort().join(",");
  const newSorted = [...newPk!.columns].sort().join(",");
  if (oldSorted !== newSorted) {
    return { type: "modified", oldColumns: oldPk!.columns, newColumns: newPk!.columns };
  }
  return undefined;
}

function compareFks(oldFks: DiscoveredForeignKey[], newFks: DiscoveredForeignKey[]): FkChange[] {
  const oldMap = new Map(oldFks.map((fk) => [fk.constraintName, fk]));
  const newMap = new Map(newFks.map((fk) => [fk.constraintName, fk]));
  const changes: FkChange[] = [];

  for (const [name, newFk] of newMap) {
    const oldFk = oldMap.get(name);
    if (!oldFk) {
      changes.push({ constraintName: name, type: "added" });
    } else if (!fkEqual(oldFk, newFk)) {
      changes.push({ constraintName: name, type: "modified" });
    }
  }

  for (const name of oldMap.keys()) {
    if (!newMap.has(name)) {
      changes.push({ constraintName: name, type: "dropped" });
    }
  }

  return changes;
}

function fkEqual(a: DiscoveredForeignKey, b: DiscoveredForeignKey): boolean {
  return (
    [...a.columns].sort().join(",") === [...b.columns].sort().join(",") &&
    a.referencedTable === b.referencedTable &&
    a.referencedSchema === b.referencedSchema &&
    [...a.referencedColumns].sort().join(",") === [...b.referencedColumns].sort().join(",")
  );
}

function compareIndexes(oldIdxs: DiscoveredIndex[], newIdxs: DiscoveredIndex[]): IndexChange[] {
  const oldMap = new Map(oldIdxs.map((idx) => [idx.indexName, idx]));
  const newMap = new Map(newIdxs.map((idx) => [idx.indexName, idx]));
  const changes: IndexChange[] = [];

  for (const [name, newIdx] of newMap) {
    const oldIdx = oldMap.get(name);
    if (!oldIdx) {
      changes.push({ indexName: name, type: "added" });
    } else if (
      [...oldIdx.columns].sort().join(",") !== [...newIdx.columns].sort().join(",") ||
      oldIdx.isUnique !== newIdx.isUnique
    ) {
      changes.push({ indexName: name, type: "modified" });
    }
  }

  for (const name of oldMap.keys()) {
    if (!newMap.has(name)) {
      changes.push({ indexName: name, type: "dropped" });
    }
  }

  return changes;
}

// ---------------------------------------------------------------------------
// Private — Summary aggregation
// ---------------------------------------------------------------------------

function buildSummary(schemas: SchemaDiffEntry[]): DiffSummary {
  const summary: DiffSummary = {
    tablesAdded: 0, tablesDropped: 0, tablesModified: 0,
    columnsAdded: 0, columnsDropped: 0, columnsModified: 0,
    pkChanges: 0, fkChanges: 0, indexChanges: 0,
  };

  for (const schema of schemas) {
    for (const table of schema.tables) {
      if (table.status === "added") summary.tablesAdded++;
      else if (table.status === "dropped") summary.tablesDropped++;
      else if (table.status === "modified") summary.tablesModified++;

      for (const col of table.columns) {
        if (col.status === "added") summary.columnsAdded++;
        else if (col.status === "dropped") summary.columnsDropped++;
        else if (col.status === "modified") summary.columnsModified++;
      }

      if (table.pkChange) summary.pkChanges++;
      summary.fkChanges += table.fkChanges.length;
      summary.indexChanges += table.indexChanges.length;
    }
  }

  return summary;
}
