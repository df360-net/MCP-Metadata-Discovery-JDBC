/**
 * Delta Payload Builder — builds targeted ingestion payloads from a SchemaDiff.
 *
 * Only pushes changed entities/elements:
 *   - Added schemas/tables/columns → create
 *   - Modified tables → upsert full table + dropped columns with is_active:"N"
 *   - Dropped schemas/tables/columns → mark is_active:"N"
 */

import type { DiscoveredDatabase, DiscoveredTable, DatabaseType } from "../discovery/types.js";
import type { IngestionResponse } from "../ingestion/types.js";
import { IngestionClient, type IngestionClientConfig } from "../ingestion/ingestion-client.js";
import { buildAppPid, buildContainerPid, buildEntityPid, buildElementPid } from "../ingestion/pid-helpers.js";
// payload-builder imports removed — pushContainerWithEntities/pushEntityWithElements on IngestionClient handle this
import type { SchemaDiff, SchemaDiffEntry, TableDiffEntry, DeltaIngestionResult, DeltaIngestionDetail } from "./types.js";

/**
 * Build and push delta ingestion payloads based on a schema diff.
 *
 * @param connectorId  Connector ID
 * @param dbType       Database type
 * @param newDb        The new (current) discovered database
 * @param oldDb        The old (previous) discovered database
 * @param diff         The computed schema diff
 * @param clientConfig Ingestion client configuration
 * @returns            Audit record of all operations performed
 */
export async function buildAndPushDelta(
  connectorId: string,
  dbType: DatabaseType,
  newDb: DiscoveredDatabase,
  oldDb: DiscoveredDatabase | null,
  diff: SchemaDiff,
  clientConfig: IngestionClientConfig,
): Promise<DeltaIngestionResult> {
  const start = Date.now();
  const client = new IngestionClient(clientConfig);
  const appPid = buildAppPid(connectorId, dbType);

  const details: DeltaIngestionDetail[] = [];
  const errors: string[] = [];

  for (const schemaDiff of diff.schemas) {
    if (schemaDiff.status === "unchanged") continue;

    if (schemaDiff.status === "added") {
      await pushAddedSchema(connectorId, dbType, newDb, schemaDiff, client, details, errors);
    } else if (schemaDiff.status === "dropped") {
      if (!oldDb) {
        errors.push(`Cannot process dropped schema ${schemaDiff.schemaName}: no previous snapshot`);
        continue;
      }
      await pushDroppedSchema(connectorId, dbType, oldDb, schemaDiff, appPid, client, details, errors);
    } else if (schemaDiff.status === "modified") {
      await pushModifiedSchema(connectorId, dbType, newDb, oldDb, schemaDiff, appPid, client, details, errors);
    }
  }

  const created = details.filter((d) => d.operation === "create" && d.success).length;
  const updated = details.filter((d) => d.operation === "update" && d.success).length;
  const deleted = details.filter((d) => d.operation === "delete" && d.success).length;
  const skipped = details.filter((d) => !d.success).length;

  return { created, updated, deleted, skipped, errors, durationMs: Date.now() - start, details };
}

// ---------------------------------------------------------------------------
// Added schema — push full container with all entities
// ---------------------------------------------------------------------------

async function pushAddedSchema(
  connectorId: string,
  dbType: DatabaseType,
  newDb: DiscoveredDatabase,
  schemaDiff: SchemaDiffEntry,
  client: IngestionClient,
  details: DeltaIngestionDetail[],
  errors: string[],
): Promise<void> {
  // Find the new schema in the discovery result
  const schema = newDb.schemas.find((s) => s.schemaName === schemaDiff.schemaName);
  if (!schema) {
    const msg = `Added schema '${schemaDiff.schemaName}' not found in discovery result`;
    console.warn(`[delta-builder] ${msg}`);
    errors.push(msg);
    return;
  }

  // Build a temporary DiscoveredDatabase with just this schema
  const singleSchemaDb: DiscoveredDatabase = { ...newDb, schemas: [schema] };

  try {
    await client.pushContainerWithEntities(connectorId, dbType, singleSchemaDb);

    const appPid = buildAppPid(connectorId, dbType);
    const containerPid = buildContainerPid(schema.schemaName, appPid);
    details.push({ operation: "create", entityType: "schema", name: schema.schemaName, pid: containerPid, success: true });

    for (const table of [...schema.tables, ...schema.views]) {
      const entityPid = buildEntityPid(table.tableName, containerPid);
      details.push({ operation: "create", entityType: "table", name: table.tableName, pid: entityPid, success: true });
      for (const col of table.columns) {
        const elemPid = buildElementPid(col.columnName, entityPid);
        details.push({ operation: "create", entityType: "column", name: `${table.tableName}.${col.columnName}`, pid: elemPid, success: true });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Failed to push added schema ${schemaDiff.schemaName}: ${msg}`);
    details.push({ operation: "create", entityType: "schema", name: schemaDiff.schemaName, pid: "", success: false, error: msg });
  }
}

// ---------------------------------------------------------------------------
// Dropped schema — mark container + all entities/elements inactive
// ---------------------------------------------------------------------------

async function pushDroppedSchema(
  connectorId: string,
  dbType: DatabaseType,
  oldDb: DiscoveredDatabase,
  schemaDiff: SchemaDiffEntry,
  appPid: string,
  client: IngestionClient,
  details: DeltaIngestionDetail[],
  errors: string[],
): Promise<void> {
  const schema = oldDb.schemas.find((s) => s.schemaName === schemaDiff.schemaName);
  if (!schema) {
    const msg = `Dropped schema '${schemaDiff.schemaName}' not found in previous snapshot`;
    console.warn(`[delta-builder] ${msg}`);
    errors.push(msg);
    return;
  }

  const containerPid = buildContainerPid(schema.schemaName, appPid);

  try {
    // Build inactive container payload
    const entities = [...schema.tables, ...schema.views].map((table) => {
      const entityPid = buildEntityPid(table.tableName, containerPid);
      return {
        entity: {
          data_entity_pid: entityPid,
          data_entity_name: table.tableName,
          data_entity_description: "",
          entity_type_pid: table.tableType === "VIEW" ? "ENT-TYP-VW" : "ENT-TYP-TBL",
          is_active: "N" as const,
        },
        elements: table.columns.map((col) => ({
          data_element_pid: buildElementPid(col.columnName, entityPid),
          data_element_name: col.columnName,
          data_element_description: "",
          data_type_pid: "DTYPE-VARCHAR",
          position: col.ordinalPosition,
          pii_indicator: "N" as const,
          is_active: "N" as const,
        })),
      };
    });

    const payload = {
      application_pid: appPid,
      container: {
        data_container_pid: containerPid,
        data_container_name: schema.schemaName,
        data_container_description: "",
        container_type_pid: "TYP-RDBMS",
        data_container_server: "discovered-via-mcp",
        is_active: "N" as const,
      },
      entities,
    };

    // Push using raw post since we need custom is_active
    const resp = await fetch(`${client.baseUrl}/container-with-entities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error(`Ingestion API ${resp.status}`);

    details.push({ operation: "delete", entityType: "schema", name: schema.schemaName, pid: containerPid, success: true });
    for (const table of [...schema.tables, ...schema.views]) {
      const entityPid = buildEntityPid(table.tableName, containerPid);
      details.push({ operation: "delete", entityType: "table", name: table.tableName, pid: entityPid, success: true });
      for (const col of table.columns) {
        details.push({ operation: "delete", entityType: "column", name: `${table.tableName}.${col.columnName}`, pid: buildElementPid(col.columnName, entityPid), success: true });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Failed to push dropped schema ${schemaDiff.schemaName}: ${msg}`);
    details.push({ operation: "delete", entityType: "schema", name: schemaDiff.schemaName, pid: containerPid, success: false, error: msg });
  }
}

// ---------------------------------------------------------------------------
// Modified schema — push only changed tables
// ---------------------------------------------------------------------------

async function pushModifiedSchema(
  connectorId: string,
  dbType: DatabaseType,
  newDb: DiscoveredDatabase,
  oldDb: DiscoveredDatabase | null,
  schemaDiff: SchemaDiffEntry,
  appPid: string,
  client: IngestionClient,
  details: DeltaIngestionDetail[],
  errors: string[],
): Promise<void> {
  const newSchema = newDb.schemas.find((s) => s.schemaName === schemaDiff.schemaName);
  const oldSchema = oldDb?.schemas.find((s) => s.schemaName === schemaDiff.schemaName);
  if (!newSchema) {
    const msg = `Modified schema '${schemaDiff.schemaName}' not found in discovery result`;
    console.warn(`[delta-builder] ${msg}`);
    errors.push(msg);
    return;
  }

  const containerPid = buildContainerPid(schemaDiff.schemaName, appPid);

  for (const tableDiff of schemaDiff.tables) {
    if (tableDiff.status === "unchanged") continue;

    try {
      if (tableDiff.status === "added") {
        const table = [...newSchema.tables, ...newSchema.views].find((t) => t.tableName === tableDiff.tableName);
        if (table) {
          await client.pushEntityWithElements(connectorId, dbType, schemaDiff.schemaName, table);
          const entityPid = buildEntityPid(table.tableName, containerPid);
          details.push({ operation: "create", entityType: "table", name: table.tableName, pid: entityPid, success: true });
          for (const col of table.columns) {
            details.push({ operation: "create", entityType: "column", name: `${table.tableName}.${col.columnName}`, pid: buildElementPid(col.columnName, entityPid), success: true });
          }
        }
      } else if (tableDiff.status === "dropped") {
        // Mark table and all columns inactive
        const oldTable = oldSchema ? [...oldSchema.tables, ...oldSchema.views].find((t) => t.tableName === tableDiff.tableName) : null;
        if (oldTable) {
          const entityPid = buildEntityPid(oldTable.tableName, containerPid);
          const payload = {
            container_pid: containerPid,
            entity: {
              data_entity_pid: entityPid,
              data_entity_name: oldTable.tableName,
              data_entity_description: "",
              entity_type_pid: oldTable.tableType === "VIEW" ? "ENT-TYP-VW" : "ENT-TYP-TBL",
              is_active: "N",
            },
            elements: oldTable.columns.map((col) => ({
              data_element_pid: buildElementPid(col.columnName, entityPid),
              data_element_name: col.columnName,
              data_element_description: "",
              data_type_pid: "DTYPE-VARCHAR",
              position: col.ordinalPosition,
              pii_indicator: "N",
              is_active: "N",
            })),
          };

          const resp = await fetch(`${client.baseUrl}/entity-with-elements`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!resp.ok) throw new Error(`Ingestion API ${resp.status}`);

          details.push({ operation: "delete", entityType: "table", name: oldTable.tableName, pid: entityPid, success: true });
          for (const col of oldTable.columns) {
            details.push({ operation: "delete", entityType: "column", name: `${oldTable.tableName}.${col.columnName}`, pid: buildElementPid(col.columnName, entityPid), success: true });
          }
        }
      } else if (tableDiff.status === "modified") {
        // Push full table from new discovery (upsert) + dropped columns
        const newTable = [...newSchema.tables, ...newSchema.views].find((t) => t.tableName === tableDiff.tableName);
        if (newTable) {
          await client.pushEntityWithElements(connectorId, dbType, schemaDiff.schemaName, newTable);
          const entityPid = buildEntityPid(newTable.tableName, containerPid);

          // If only FK/index/PK changes (no column-level diff), record entity-level update
          const hasColumnChanges = tableDiff.columns.some((c) => c.status !== "unchanged");
          if (!hasColumnChanges) {
            details.push({ operation: "update", entityType: "table", name: newTable.tableName, pid: entityPid, success: true });
          }

          // Record per-column operations from the diff
          for (const colDiff of tableDiff.columns) {
            if (colDiff.status === "added") {
              details.push({ operation: "create", entityType: "column", name: `${newTable.tableName}.${colDiff.columnName}`, pid: buildElementPid(colDiff.columnName, entityPid), success: true });
            } else if (colDiff.status === "modified") {
              details.push({ operation: "update", entityType: "column", name: `${newTable.tableName}.${colDiff.columnName}`, pid: buildElementPid(colDiff.columnName, entityPid), success: true });
            } else if (colDiff.status === "dropped") {
              // Push dropped column as inactive
              const droppedElemPid = buildElementPid(colDiff.columnName, entityPid);
              const dropPayload = {
                container_pid: containerPid,
                entity: {
                  data_entity_pid: entityPid,
                  data_entity_name: newTable.tableName,
                  data_entity_description: newTable.tableComment ? `${newTable.tableType} ${newTable.tableComment}` : newTable.tableType,
                  entity_type_pid: newTable.tableType === "VIEW" ? "ENT-TYP-VW" : "ENT-TYP-TBL",
                  is_active: "Y" as const,
                },
                elements: [{
                  data_element_pid: droppedElemPid,
                  data_element_name: colDiff.columnName,
                  data_element_description: "DROPPED",
                  data_type_pid: "DTYPE-VARCHAR",
                  position: 0,
                  pii_indicator: "N",
                  is_active: "N",
                }],
              };
              try {
                const resp = await fetch(`${client.baseUrl}/entity-with-elements`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(dropPayload),
                });
                if (!resp.ok) throw new Error(`Ingestion API ${resp.status}`);
                details.push({ operation: "delete", entityType: "column", name: `${newTable.tableName}.${colDiff.columnName}`, pid: droppedElemPid, success: true });
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                details.push({ operation: "delete", entityType: "column", name: `${newTable.tableName}.${colDiff.columnName}`, pid: droppedElemPid, success: false, error: msg });
                errors.push(msg);
              }
            }
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to push ${tableDiff.status} table ${tableDiff.tableName}: ${msg}`);
      const entityPid = buildEntityPid(tableDiff.tableName, containerPid);
      details.push({
        operation: tableDiff.status === "added" ? "create" : tableDiff.status === "dropped" ? "delete" : "update",
        entityType: "table", name: tableDiff.tableName, pid: entityPid, success: false, error: msg,
      });
    }
  }
}
