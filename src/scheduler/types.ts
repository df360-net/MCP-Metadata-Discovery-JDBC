/**
 * Scheduler Types — Scheduled Delta Discovery & Ingestion
 */

// ── Scheduled Job ──

export interface ScheduledJob {
  id: string;
  connectorId: string;
  name: string;
  scheduleType: "interval" | "daily";
  intervalSeconds?: number;
  dailyRunTime?: string;          // "HH:MM"
  timeoutSeconds: number;
  pushChanges: boolean;
  isEnabled: boolean;
  nextRunAt: string;              // ISO timestamp
  createdAt: string;
  updatedAt: string;
}

// ── Job Run (with full audit) ──

export type RunStatus = "RUNNING" | "COMPLETED" | "FAILED" | "TIMED_OUT" | "NO_CHANGES";

export interface JobRun {
  id: string;
  jobId: string;
  connectorId: string;
  status: RunStatus;
  triggeredBy: "SCHEDULER" | "MANUAL";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  discoverySummary?: DiscoveryAudit;
  diff?: SchemaDiff;
  ingestionResult?: DeltaIngestionResult;
  error?: string;
}

export interface DiscoveryAudit {
  schemasFound: number;
  tablesFound: number;
  viewsFound: number;
  columnsFound: number;
  foreignKeysFound: number;
  indexesFound: number;
  discoveryDurationMs: number;
}

// ── Schema Diff ──

export interface SchemaDiff {
  hasChanges: boolean;
  summary: DiffSummary;
  schemas: SchemaDiffEntry[];
}

export interface DiffSummary {
  tablesAdded: number;
  tablesDropped: number;
  tablesModified: number;
  columnsAdded: number;
  columnsDropped: number;
  columnsModified: number;
  pkChanges: number;
  fkChanges: number;
  indexChanges: number;
}

export interface SchemaDiffEntry {
  schemaName: string;
  status: "added" | "dropped" | "modified" | "unchanged";
  tables: TableDiffEntry[];
}

export interface TableDiffEntry {
  tableName: string;
  tableType: "TABLE" | "VIEW";
  status: "added" | "dropped" | "modified" | "unchanged";
  columns: ColumnDiffEntry[];
  pkChange?: PkChange;
  fkChanges: FkChange[];
  indexChanges: IndexChange[];
}

export interface ColumnDiffEntry {
  columnName: string;
  status: "added" | "dropped" | "modified" | "unchanged";
  changes?: ColumnChange[];
}

export interface ColumnChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface PkChange {
  type: "added" | "dropped" | "modified";
  oldColumns?: string[];
  newColumns?: string[];
}

export interface FkChange {
  constraintName: string;
  type: "added" | "dropped" | "modified";
}

export interface IndexChange {
  indexName: string;
  type: "added" | "dropped" | "modified";
}

// ── Delta Ingestion Result ──

export interface DeltaIngestionResult {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  errors: string[];
  durationMs: number;
  details: DeltaIngestionDetail[];
}

export interface DeltaIngestionDetail {
  operation: "create" | "update" | "delete";
  entityType: "schema" | "table" | "column";
  name: string;
  pid: string;
  success: boolean;
  error?: string;
}
