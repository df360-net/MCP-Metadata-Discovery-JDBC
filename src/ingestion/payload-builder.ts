/**
 * Payload Builder — transforms DiscoveredDatabase into DCF ingestion payloads.
 *
 * Converts the hierarchical discovery result (schemas → tables → columns)
 * into the flat PID-based payloads that the DCF ingestion API expects.
 */

import type { DiscoveredDatabase, DiscoveredTable, DiscoveredColumn, DatabaseType } from "../discovery/types.js";
import type {
  ContainerWithEntitiesPayload,
  EntityWithElementsPayload,
  ElementPayload,
  EntityWithElements,
  LineagePayload,
  LineageEdgePayload,
} from "./types.js";
import { buildAppPid, buildContainerPid, buildEntityPid, buildElementPid } from "./pid-helpers.js";
import { mapDataType } from "./dtype-mapping.js";

// ---------------------------------------------------------------------------
// 1. Container with Entities — full schema push
// ---------------------------------------------------------------------------

/**
 * Build a ContainerWithEntitiesPayload for each schema in the discovered database.
 * Returns one payload per schema (matching DCF convention: one container = one schema).
 */
export function buildContainerPayloads(
  connectorId: string,
  dbType: DatabaseType,
  db: DiscoveredDatabase,
): ContainerWithEntitiesPayload[] {
  const appPid = buildAppPid(connectorId, dbType);

  return db.schemas.map((schema) => {
    const containerPid = buildContainerPid(schema.schemaName, appPid);

    const entities: EntityWithElements[] = [];

    // Tables
    for (const table of schema.tables) {
      entities.push(buildEntityWithElements(table, containerPid));
    }

    // Views
    for (const view of schema.views) {
      entities.push(buildEntityWithElements(view, containerPid));
    }

    return {
      application_pid: appPid,
      container: {
        data_container_pid: containerPid,
        data_container_name: schema.schemaName,
        data_container_description: `${dbType} ${db.serverVersion?.slice(0, 50) ?? ""} — ${schema.schemaName} schema`,
        container_type_pid: "TYP-RDBMS",
        data_container_server: `discovered-via-mcp`,
        is_active: "Y",
      },
      entities,
    };
  });
}

// ---------------------------------------------------------------------------
// 2. Entity with Elements — single table push
// ---------------------------------------------------------------------------

/**
 * Build an EntityWithElementsPayload for a single table.
 */
export function buildEntityPayload(
  connectorId: string,
  dbType: DatabaseType,
  schemaName: string,
  table: DiscoveredTable,
): EntityWithElementsPayload {
  const appPid = buildAppPid(connectorId, dbType);
  const containerPid = buildContainerPid(schemaName, appPid);
  const ent = buildEntityWithElements(table, containerPid);

  return {
    container_pid: containerPid,
    entity: ent.entity,
    elements: ent.elements,
  };
}

// ---------------------------------------------------------------------------
// 3. Lineage — FK edges
// ---------------------------------------------------------------------------

/**
 * Build a LineagePayload from all foreign keys in the discovered database.
 */
export function buildLineagePayload(
  connectorId: string,
  dbType: DatabaseType,
  db: DiscoveredDatabase,
): LineagePayload {
  const appPid = buildAppPid(connectorId, dbType);
  const edges: LineageEdgePayload[] = [];

  for (const schema of db.schemas) {
    for (const table of [...schema.tables, ...schema.views]) {
      const containerPid = buildContainerPid(schema.schemaName, appPid);
      const entityPid = buildEntityPid(table.tableName, containerPid);

      for (const fk of table.foreignKeys) {
        const refContainerPid = buildContainerPid(fk.referencedSchema, appPid);
        const refEntityPid = buildEntityPid(fk.referencedTable, refContainerPid);

        if (!fk.columns?.length || !fk.referencedColumns?.length || fk.columns.length !== fk.referencedColumns.length) continue;
        for (let i = 0; i < fk.columns.length; i++) {
          if (!fk.columns[i] || !fk.referencedColumns[i]) continue;
          const sourceElementPid = buildElementPid(fk.columns[i], entityPid);
          const targetElementPid = buildElementPid(fk.referencedColumns[i], refEntityPid);

          edges.push({
            source_element_pid: sourceElementPid,
            target_element_pid: targetElementPid,
          });
        }
      }
    }
  }

  return {
    application_pid: appPid,
    lineage_source: "FK",
    edges,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildEntityWithElements(table: DiscoveredTable, containerPid: string): EntityWithElements {
  const entityPid = buildEntityPid(table.tableName, containerPid);
  const entityTypePid = table.tableType === "VIEW" ? "ENT-TYP-VW" : "ENT-TYP-TBL";

  // Build entity description with row count and size info
  const descParts: string[] = [table.tableType];
  if (table.estimatedRowCount != null) {
    descParts.push(`~${table.estimatedRowCount.toLocaleString()} rows`);
  }
  if (table.sizeBytes != null) {
    descParts.push(formatBytes(table.sizeBytes));
  }
  if (table.tableComment) {
    descParts.push(table.tableComment);
  }

  const elements: ElementPayload[] = table.columns.map((col) =>
    buildElement(col, entityPid, table),
  );

  return {
    entity: {
      data_entity_pid: entityPid,
      data_entity_name: table.tableName,
      data_entity_description: descParts.join(" "),
      entity_type_pid: entityTypePid,
      is_active: "Y",
    },
    elements,
  };
}

function buildElement(
  col: DiscoveredColumn,
  entityPid: string,
  table: DiscoveredTable,
): ElementPayload {
  const elementPid = buildElementPid(col.columnName, entityPid);

  // Build description matching DCF format: "varchar(255) NOT NULL PK AUTO_INCREMENT"
  const descParts: string[] = [col.fullDataType];
  if (!col.isNullable) descParts.push("NOT NULL");
  if (col.isPrimaryKey) descParts.push("PK");
  if (col.isAutoIncrement) descParts.push("AUTO_INCREMENT");
  if (col.columnComment) descParts.push(col.columnComment);

  // Check if this column is a FK
  const isFk = table.foreignKeys.some((fk) => fk.columns.includes(col.columnName));
  if (isFk) descParts.push("FK");

  return {
    data_element_pid: elementPid,
    data_element_name: col.columnName,
    data_element_description: descParts.join(" "),
    data_type_pid: mapDataType(col.dataType),
    position: col.ordinalPosition,
    length: col.characterMaxLength,
    precision: col.numericPrecision,
    scale: col.numericScale,
    pii_indicator: isPiiColumn(col.columnName) ? "Y" : "N",
    is_active: "Y",
  };
}

const PII_PATTERN = /password|passwd|secret|ssn|social.?security|credit.?card|card.?number|email|phone|mobile|address|date.?of.?birth|dob|national.?id|passport|driver.?license|bank.?account|routing.?number|api.?key|token/i;

function isPiiColumn(columnName: string): boolean {
  return PII_PATTERN.test(columnName);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
