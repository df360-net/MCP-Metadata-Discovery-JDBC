# How Incremental Metadata Ingestion Works

**Audience:** Development team  
**Version:** 1.0  
**Date:** 2026-04-14

---

## 1. Executive Summary

Incremental metadata ingestion is the ability to push **only changes** (added, modified, or deleted schemas/tables/columns) to our metadata catalog (DCF), instead of re-uploading everything every time. This document explains how the pipeline works end-to-end so that engineers adding new connectors, modifying ingestion logic, or debugging production issues have a complete mental model.

The system combines five components:

1. **Scheduler Engine** — runs discovery on a cron-like schedule
2. **Discovery Manager** — fetches current schema state via JDBC sidecar
3. **Schema Differ** — compares the new state against the last known snapshot
4. **Delta Payload Builder** — constructs change-only payloads
5. **Ingestion Client** — pushes payloads to DCF (or the local mock) with retries

The key design property that makes incremental ingestion work is **stable, deterministic PIDs (persistent identifiers)**. The same column in the same table in the same database always produces the same PID across runs, which lets DCF identify whether an incoming record is a create, update, or delete.

---

## 2. End-to-End Pipeline

```
┌──────────────────┐
│ Scheduler Engine │  Tick every 5s, find due jobs
└────────┬─────────┘
         │
         ▼
┌──────────────────┐   1. Load OLD snapshot from disk (before overwriting)
│ Discovery Manager│   2. Run JDBC discovery via Java sidecar
│                  │   3. Cache NEW snapshot (memory + disk)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐   Compare OLD vs NEW schemas by hierarchical key
│  Schema Differ   │   Output: SchemaDiff with per-entity status
└────────┬─────────┘   (unchanged / added / dropped / modified)
         │
         ▼
┌────────────────────────┐   Only for changes:
│ Delta Payload Builder  │   - Added: normal upsert with is_active="Y"
│                        │   - Modified: full table upsert (DCF reconciles)
│                        │   - Dropped: upsert with is_active="N" (soft delete)
└────────┬───────────────┘
         │
         ▼
┌──────────────────┐   HTTP POST with exponential backoff retry
│ Ingestion Client │   Routes: /container-with-entities,
│                  │           /entity-with-elements,
│                  │           /lineage
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│       DCF        │   (Production) OR local mock for testing
└──────────────────┘
```

---

## 3. The Foundation: Hierarchical PIDs

Every piece of metadata gets a **deterministic PID** based on the `connectorId`, database type, and names in the metadata hierarchy. Because names are normalized (uppercased, special characters replaced), the PID is stable across discovery runs. This is what lets DCF tell "this is the same column I ingested last week — update it" from "this is a brand-new column — insert it."

### PID Structure

Defined in [`src/ingestion/pid-helpers.ts`](../src/ingestion/pid-helpers.ts).

| Level | Format | Example |
|-------|--------|---------|
| Application | `APP-DISC-{ALIAS}-{DBTYPE}-01` | `APP-DISC-PROD-DB-01-POSTGRESQL-01` |
| Container (schema) | `{SCHEMA}@{APP_PID}` | `PUBLIC@APP-DISC-PROD-DB-01-POSTGRESQL-01` |
| Entity (table) | `{TABLE}@{CONTAINER_PID}` | `USERS@PUBLIC@APP-DISC-PROD-DB-01-POSTGRESQL-01` |
| Element (column) | `{COLUMN}@{ENTITY_PID}` | `ID@USERS@PUBLIC@APP-DISC-PROD-DB-01-POSTGRESQL-01` |

### Stability Contract

- `ALIAS = connectorId.toUpperCase().replace(/[^A-Z0-9]/g, "-")`
- Schema, table, and column names are uppercased
- The structure uses `@` as separator (never appears in valid identifiers)

**Consequence:** If a developer renames a column on the source, it produces a *new* PID. The old column becomes orphaned in DCF (no longer sent, so it's implicitly stale but remains until explicitly deleted). Dropping the column via the differ generates an explicit `is_active="N"` delete. This is by design — it avoids the PID rename problem ("was column `user_id` renamed to `uid`, or was `user_id` dropped and `uid` added?"), which is impossible to answer without external guidance.

---

## 4. Component Deep-Dive

### 4.1 Scheduler Engine

**File:** [`src/scheduler/engine.ts`](../src/scheduler/engine.ts)

The engine runs a **tick loop** (default every 5 seconds; configurable via `scheduler.tickIntervalMs`). On each tick:

1. Skip if already mid-tick or shutting down
2. Find all jobs where `nextRunAt ≤ now` AND `isEnabled = true`
3. For each due job:
   - Immediately advance `nextRunAt` (prevents re-triggering if execution takes longer than the interval)
   - Call `executeJob()` asynchronously

### Schedule Types

| Type | Fields | Behavior |
|------|--------|----------|
| `interval` | `intervalSeconds` | Runs every N seconds (e.g., 3600 = hourly) |
| `daily` | `dailyRunTime` (HH:MM) | Runs once per day at the specified local time |

### Job Record (`ScheduledJob`)

```typescript
{
  id: string,                            // UUID
  connectorId: string,                   // FK to connector config
  name: string,                          // Human-readable
  scheduleType: "interval" | "daily",
  intervalSeconds?: number,
  dailyRunTime?: string,                 // "HH:MM"
  timeoutSeconds: number,                // Per-run timeout
  pushChanges: boolean,                  // If false, diff but don't push
  isEnabled: boolean,
  nextRunAt: string,                     // ISO timestamp
  createdAt, updatedAt
}
```

### 4.2 Run Execution Flow

The heart of `executeRunLogic()` (engine.ts) executes in this exact order:

```
1. Load OLD snapshot from disk
   ↓  (via getLastDiscoverySnapshot — reads file directly, bypasses TTL)
2. Run new discovery with Promise.race timeout
   ↓  (discoveryManager.discoverMetadata — now cache contains NEW)
3. Pull new snapshot from cache
   ↓
4. Build DiscoveryAudit (table counts, duration)
   ↓
5. Compute diff: compareSchemas(oldDb, newDb)
      If OLD was null (first run) → allAddedDiff(newDb)
   ↓
6. If !diff.hasChanges → status = NO_CHANGES, return
   ↓
7. If pushChanges → buildAndPushDelta() → DCF
   ↓
8. Record COMPLETED run with full audit trail
```

### Why Load Old Snapshot First?

Step 1 is critical. Once discovery writes the new result to cache/disk, the old version is gone. By reading `{connectorId}.discovery.json` **before** triggering discovery, we guarantee we have both states available for the diff.

### 4.3 Schema Differ

**File:** [`src/scheduler/schema-differ.ts`](../src/scheduler/schema-differ.ts)

The differ walks the hierarchy **schema → table → column** and produces a structured `SchemaDiff`:

```typescript
SchemaDiff {
  hasChanges: boolean,
  summary: {
    tablesAdded, tablesDropped, tablesModified,
    columnsAdded, columnsDropped, columnsModified,
    pkChanges, fkChanges, indexChanges
  },
  entries: SchemaDiffEntry[]  // One per schema
}
```

### Matching Logic

- **Schemas**: matched by `schemaName`
- **Tables/Views**: matched by `tableName` within their schema
- **Columns**: matched by `columnName` within their table
- **Foreign keys**: matched by `constraintName`
- **Indexes**: matched by `indexName`

Anything in OLD but not in NEW is `dropped`. Anything in NEW but not in OLD is `added`. Anything in both is compared field-by-field for `modified`.

### Column-Level Change Detection

The differ compares these 11 fields for each column:

```
dataType, fullDataType, isNullable, columnDefault, ordinalPosition,
characterMaxLength, numericPrecision, numericScale,
isPrimaryKey, isAutoIncrement, columnComment
```

A `ColumnChange` record is emitted for *each* field that differs, including the old and new values:

```typescript
{ field: "fullDataType", oldValue: "varchar(50)", newValue: "varchar(255)" }
```

This is valuable for audit trails: you can answer "what changed on column X between Monday and Tuesday?" directly from the run history.

### 4.4 Delta Payload Builder

**File:** [`src/scheduler/delta-payload-builder.ts`](../src/scheduler/delta-payload-builder.ts)

Given a `SchemaDiff` with changes, this module constructs the minimum set of HTTP calls to sync DCF.

### Strategy by Schema Status

| Schema Status | Action |
|---------------|--------|
| `added` | Single POST `/container-with-entities` (full schema + tables + columns), `is_active="Y"` |
| `dropped` | Single POST `/container-with-entities` with `is_active="N"` on container, entities, and elements |
| `modified` | Iterate tables; per-table diff-based push |

### Per-Table Strategy (within a modified schema)

| Table Status | Action |
|--------------|--------|
| `added` | POST `/entity-with-elements` (full table, `is_active="Y"`) |
| `modified` | POST `/entity-with-elements` (full table upsert; DCF reconciles column-level changes) |
| `dropped` | POST `/entity-with-elements` with `is_active="N"` on entity + all elements |

### Per-Column Strategy (within a modified table)

When a column is **added** or **modified**, no extra call is needed — the full-table upsert above covers it.

When a column is **dropped** within an otherwise-surviving table, the builder posts a custom `/entity-with-elements` with just that element marked `is_active="N"`. The entity itself stays `"Y"`.

### What This Saves

For a 500-table database where 3 columns changed in 1 table:
- **Full push**: 500 entity POSTs + all elements
- **Delta push**: 1 entity POST + up to 1 column-drop POST

On typical daily discoveries where schemas drift slowly, this is **orders of magnitude less network traffic** and lets DCF avoid unnecessary upserts.

### 4.5 Ingestion Client

**File:** [`src/ingestion/ingestion-client.ts`](../src/ingestion/ingestion-client.ts)

Generic HTTP client that abstracts the three DCF endpoints:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `pushContainerWithEntities` | `POST /container-with-entities` | Full schema push |
| `pushEntityWithElements` | `POST /entity-with-elements` | Single table push |
| `pushLineage` | `POST /lineage` | FK (or other) lineage edges |
| `pushAll` | Convenience wrapper | All schemas + lineage in one call (used for full push) |

### Resilience

- **Timeout**: configurable via `ingestion.timeoutMs` (default 30s), enforced with `AbortController`
- **Retries**: up to 2 retries with exponential backoff (`2^attempt * 1000ms`) on:
  - 5xx HTTP status codes
  - Network errors (`ECONNREFUSED`, `AbortError`)
- **Non-retryable**: 4xx responses (logic errors) fail immediately; the scheduler records the error
- **Auth**: `Bearer {apiKey}` header when `ingestion.apiKey` is configured (production DCF)

### Switching Between Mock and Production

The client is environment-agnostic:

```json
// Local dev (uses mock server on same port)
"ingestion": {
  "baseUrl": "http://localhost:8090/api/v1/ingest"
}

// Production
"ingestion": {
  "baseUrl": "https://your-ingestion-api.example.com/api/v1/ingest",
  "apiKey": "your-api-key-here"
}
```

---

## 5. Run Persistence and Recovery

**File:** [`src/scheduler/store.ts`](../src/scheduler/store.ts)

### Storage Format

JSONL (newline-delimited JSON) for append-only efficiency:

- `{dataDir}/scheduler-jobs.jsonl` — one line per ScheduledJob
- `{dataDir}/scheduler-runs.jsonl` — one line per JobRun

Writes use the atomic **temp-file + rename** pattern to survive crashes mid-write.

### Orphaned Run Recovery

On server startup, the store calls `recoverOrphanedRuns()`:

- Any run with status `RUNNING` is assumed to be a crash victim
- It's marked as `FAILED` with `error = "Run orphaned due to server restart"` and duration calculated from `startedAt`

This keeps the run history honest — you'll never see a run stuck in `RUNNING` forever after a deployment.

### Run Statuses

| Status | Meaning |
|--------|---------|
| `RUNNING` | Currently executing (transient) |
| `COMPLETED` | Finished successfully with changes pushed |
| `NO_CHANGES` | Discovery + diff ran, but nothing changed |
| `FAILED` | Error during discovery, diff, or ingestion |
| `TIMED_OUT` | Exceeded `timeoutSeconds` |

### Audit Trail

Every `JobRun` captures (as available):

- `discoverySummary` — DiscoveryAudit (tables, columns, FKs, duration)
- `diff` — full SchemaDiff (per-column oldValue/newValue)
- `ingestionResult` — DeltaIngestionResult (created/updated/deleted counts + per-entity detail)
- `error` — error message if applicable

---

## 6. Concurrency and Safety

### In-Flight Discovery Protection

The `DiscoveryManager` uses `inFlightDiscoveries: Map<connectorId, Promise>` to prevent concurrent discoveries against the same connector. If the UI user clicks "Discover" while the scheduler is already running discovery on that connector, both requests receive the same Promise.

### Scheduler Tick Re-Entrancy Guard

The engine's `tick()` method returns early if `isRunning` is true. Long-running jobs cannot stall the tick loop because job execution is detached (async, not awaited).

### `nextRunAt` Advance on Execute

Advancing `nextRunAt` *before* executing (rather than after) means that if a job takes longer than its interval, we don't pile up a backlog — the next run is scheduled based on when the current one started, not finished.

### Cache Consistency

- **In-memory cache**: TTL-based eviction (default 24h), size-limited (default 100 entries)
- **Disk cache**: unbounded, one file per connector; always reflects the latest discovery
- **Snapshot reads**: `getLastDiscoverySnapshot()` always reads from disk, bypassing TTL

---

## 7. The Mock Ingestion Server

**File:** [`src/ingestion/mock-ingest-routes.ts`](../src/ingestion/mock-ingest-routes.ts)

Runs on the same port (8090) as the Node.js server. It persists payloads to JSON files under `{dataDir}/metadata-ingestion/` and returns responses in the same shape as real DCF.

### Storage Layout

```
data/metadata-ingestion/
  APP-DISC-PG-DF360-POSTGRESQL-01.json         # All containers/entities/elements
  lineage-APP-DISC-PG-DF360-POSTGRESQL-01.json # All lineage edges for this app
```

Each store file is a keyed dictionary:
- Containers keyed by `data_container_pid`
- Entities keyed by `data_entity_pid`
- Elements keyed by `data_element_pid`
- Lineage edges keyed by `{source_pid}|{target_pid}`

### Response Shape

```typescript
{
  status: "completed",
  summary: { total, created, updated, unchanged, failed },
  results: [{ pid, action: "created" | "updated" | "unchanged" | "failed", id, error? }]
}
```

### Validation

- Lineage `lineage_source` must be one of: `FK`, `OPERATIONAL`, `ETL`, `SQL_PARSER`, `MANUAL`
- Self-referencing edges (source = target) are rejected
- Required fields trigger 400 responses for malformed payloads

This mock is deliberately close to real DCF semantics so the team can develop and test locally without any backend dependencies.

---

## 8. REST API for Operations

**File:** [`src/scheduler/scheduler-routes.ts`](../src/scheduler/scheduler-routes.ts)

Endpoints for the Admin UI and ops tooling:

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/scheduler/jobs` | List all jobs (with latestRun summary) |
| `GET` | `/api/scheduler/jobs/:id` | Get single job + latestRun |
| `POST` | `/api/scheduler/jobs` | Create job |
| `PUT` | `/api/scheduler/jobs/:id` | Update job (recalculates `nextRunAt` if schedule changed) |
| `DELETE` | `/api/scheduler/jobs/:id` | Delete job |
| `POST` | `/api/scheduler/jobs/:id/trigger` | Manually trigger (marks `triggeredBy = MANUAL`) |
| `GET` | `/api/scheduler/jobs/:id/runs` | Paginated run history |
| `GET` | `/api/scheduler/runs/:id` | Full run with audit |

### Operational Use

- **Audit inquiry**: "What tables changed in PROD last night?" → `GET /runs/:id` and read `diff.summary` + `diff.entries`
- **Debug failed run**: `GET /runs/:id` → read `error` field + `ingestionResult.details` to find which entity failed
- **Force immediate run**: `POST /jobs/:id/trigger` (useful for pipeline recovery after DB maintenance)

---

## 9. Observability

### What to Log/Monitor

Per-run health:
- `status` distribution (COMPLETED vs FAILED vs TIMED_OUT rate)
- `durationMs` trend (detect degrading discovery performance)
- `ingestionResult.skipped` / `errors` counts (DCF rejection signals)

Per-connector health:
- Last successful run timestamp (stale connectors)
- Growth of `diff.summary.*` counts (unusual churn signal)

### Debugging Checklist

| Symptom | First check |
|---------|-------------|
| Run always `NO_CHANGES` | Is source really not changing, or is diff broken? Compare two `.discovery.json` snapshots manually |
| Run always `FAILED` on discovery | JDBC sidecar logs, network/auth to source DB |
| Run succeeds but DCF shows stale data | Verify `pushChanges=true` on job, check ingestion response `results[]` for `failed` actions |
| `TIMED_OUT` | Increase `timeoutSeconds`, or check if source DB is slow/large (schema count × table count × column avg) |
| Orphaned `RUNNING` state | Shouldn't happen post-startup recovery — investigate if it appears during normal operation (indicates engine bug) |

---

## 10. Extension Points

Common changes the team should know how to make:

### Adding a New Database Type

1. Add JDBC driver JAR or Maven dep in `jdbc-service/build.gradle`
2. Add a case in `buildJdbcUrl()` in [`src/discovery/connectors/jdbc.ts`](../src/discovery/connectors/jdbc.ts)
3. Add the type to `JDBC_TYPES` Set in [`src/discovery/connector-factory.ts`](../src/discovery/connector-factory.ts)
4. Handle database-specific quirks in `MetadataDiscoveryService.java` (excluded schemas, catalog/schema parameter mapping)

### Adding a New Type Modifier to Strip

Edit the regex in [`src/ingestion/dtype-mapping.ts`](../src/ingestion/dtype-mapping.ts):
```typescript
.replace(/\b(unsigned|signed|zerofill|identity|YOUR_NEW_MODIFIER)\b/g, "")
```

### Adding a New Column Field to Diff

Add the field name to `COLUMN_FIELDS` in [`src/scheduler/schema-differ.ts`](../src/scheduler/schema-differ.ts). The differ will automatically detect changes and emit `ColumnChange` entries.

### Changing Diff Behavior (e.g., ignore case on names)

Modify the matching key functions in the differ (currently raw name matching). Be careful — this can break PID stability if applied inconsistently with `pid-helpers.ts`.

---

## 11. Operational Runbook

### Deploying a Code Change That Affects Payload Shape

1. Deploy code to staging
2. Trigger manual run against a staging connector
3. Inspect the ingestion output (mock or staging DCF) to confirm payload shape
4. Compare run's `diff.summary` against expectations
5. Only then promote to production

### Recovering From a Bad Ingestion (Poisoned Delta)

If a delta push corrupted DCF state:

1. Disable the schedule: `PUT /api/scheduler/jobs/:id` with `isEnabled: false`
2. Roll back DCF to a known-good state (out of scope for this project)
3. Delete the local disk snapshot: `rm data/{connectorId}.discovery.json`
4. Delete the mock ingestion files (if applicable): `rm data/metadata-ingestion/APP-DISC-*.json`
5. Trigger a fresh full discovery + push: `POST /api/connectors/:id/discover` then `POST /api/connectors/:id/push`
6. Re-enable the schedule

### Disabling Incremental Ingestion for a Job (Emergency)

Set `pushChanges: false` on the job. Discovery still runs, diffs are still recorded, but nothing is pushed to DCF. Useful for:
- Dry-run testing of new schemas
- Temporarily holding off downstream propagation while debugging

---

## 12. Summary

| Property | Value |
|----------|-------|
| **Trigger** | Scheduler tick loop (every 5s by default) |
| **Diff granularity** | Schema → table → column → field-level |
| **Payload efficiency** | Only changed schemas/tables pushed; unchanged entities skipped entirely |
| **Delete semantics** | Soft delete via `is_active="N"` |
| **Identity mechanism** | Deterministic hierarchical PIDs — stable across runs as long as names don't change |
| **Concurrency safety** | Per-connector in-flight guards + tick re-entrancy guard + atomic file writes |
| **Failure recovery** | Orphaned RUNNING → FAILED on startup; exponential backoff on ingestion; run-level retry via manual trigger |
| **Audit** | Every run persisted with full diff, ingestion result, and timing |

The design prioritizes **correctness over cleverness**: full-table upserts for modified tables (letting DCF reconcile internally) rather than hand-crafting column-level diff payloads. This trades a small amount of network traffic for substantial reduction in code complexity and bug surface area.
