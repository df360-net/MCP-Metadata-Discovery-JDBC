/**
 * PID generation helpers — matches DCF discoveryEngine.ts conventions.
 *
 * PID format:
 *   Container:  {SCHEMA}@{APP_PID}
 *   Entity:     {TABLE}@{CONTAINER_PID}
 *   Element:    {COLUMN}@{ENTITY_PID}
 *
 * Normalization: uppercase, no extra transformations (column/table names kept as-is).
 */

/**
 * Build the application PID for a connector.
 * Convention: APP-DISC-{ALIAS}-{DBTYPE}-01
 */
export function buildAppPid(connectorId: string, dbType: string): string {
  const alias = (connectorId ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "-");
  return `APP-DISC-${alias}-${dbType ?? "UNKNOWN"}-01`;
}

/** Build container PID: SCHEMA@APP_PID */
export function buildContainerPid(schemaName: string, appPid: string): string {
  return `${(schemaName ?? "").toUpperCase()}@${appPid}`;
}

/** Build entity PID: TABLE@CONTAINER_PID */
export function buildEntityPid(tableName: string, containerPid: string): string {
  return `${(tableName ?? "").toUpperCase()}@${containerPid}`;
}

/** Build element PID: COLUMN@ENTITY_PID */
export function buildElementPid(columnName: string, entityPid: string): string {
  return `${(columnName ?? "").toUpperCase()}@${entityPid}`;
}
