/**
 * Scheduler Engine — tick-based execution of scheduled discovery + diff + delta push.
 * Adapted from mcp-asksql/src/scheduler/engine.ts.
 */

import type { SchedulerStore } from "./store.js";
import type { ScheduledJob, DiscoveryAudit } from "./types.js";
import type { DiscoveryManager } from "../discovery-manager.js";
import type { IngestionTargetConfig } from "../config.js";
import type { IngestionClientConfig } from "../ingestion/ingestion-client.js";
import { compareSchemas, allAddedDiff } from "./schema-differ.js";
import { buildAndPushDelta } from "./delta-payload-builder.js";

export interface SchedulerEngineConfig {
  store: SchedulerStore;
  discoveryManager: DiscoveryManager;
  ingestionConfig?: IngestionTargetConfig;
  defaultIngestUrl: string;
  tickIntervalMs?: number;
}

export class SchedulerEngine {
  private store: SchedulerStore;
  private manager: DiscoveryManager;
  private ingestionConfig?: IngestionTargetConfig;
  private defaultIngestUrl: string;
  private tickIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private shuttingDown = false;

  constructor(config: SchedulerEngineConfig) {
    this.store = config.store;
    this.manager = config.discoveryManager;
    this.ingestionConfig = config.ingestionConfig;
    this.defaultIngestUrl = config.defaultIngestUrl;
    this.tickIntervalMs = config.tickIntervalMs ?? 5000;
  }

  start(): void {
    const recovered = this.store.recoverOrphanedRuns();
    if (recovered > 0) {
      console.error(`[scheduler] Recovered ${recovered} orphaned run(s) from previous crash`);
    }
    this.shuttingDown = false;
    this.timer = setInterval(() => this.tick(), this.tickIntervalMs);
    console.error(`[scheduler] Engine started (tick every ${this.tickIntervalMs}ms)`);
  }

  stop(): void {
    this.shuttingDown = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.error("[scheduler] Engine stopped");
  }

  async triggerJob(jobId: string): Promise<string | null> {
    const job = this.store.getJob(jobId);
    if (!job) return null;

    const connectorConfig = this.manager.getConnectorConfig(job.connectorId);
    if (!connectorConfig) return null;

    const run = this.store.createRun({
      jobId: job.id,
      connectorId: job.connectorId,
      status: "RUNNING",
      triggeredBy: "MANUAL",
      startedAt: new Date().toISOString(),
    });

    this.executeJobInBackground(job, run.id).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[scheduler] Background trigger failed for run ${run.id}:`, msg);
      // Ensure run is marked as FAILED even on unexpected errors
      try {
        this.store.updateRun(run.id, {
          status: "FAILED",
          completedAt: new Date().toISOString(),
          error: `Unexpected: ${msg}`,
        });
      } catch { /* best-effort */ }
    });

    return run.id;
  }

  // ---------------------------------------------------------------------------
  // Private — Tick loop
  // ---------------------------------------------------------------------------

  private async tick(): Promise<void> {
    if (this.shuttingDown || this.running) return;
    this.running = true;

    try {
      const dueJobs = this.store.findDueJobs();
      for (const job of dueJobs) {
        if (this.shuttingDown) break;
        await this.executeJob(job);
      }
    } catch (err) {
      console.error("[scheduler] Tick error:", err instanceof Error ? err.message : err);
    } finally {
      this.running = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private — Job execution
  // ---------------------------------------------------------------------------

  private async executeJob(job: ScheduledJob): Promise<void> {
    // Always advance schedule first to prevent repeated triggers
    this.advanceNextRun(job);

    const connectorConfig = this.manager.getConnectorConfig(job.connectorId);
    if (!connectorConfig) {
      console.error(`[scheduler] Connector '${job.connectorId}' not found for job '${job.name}', skipping`);
      return;
    }

    const run = this.store.createRun({
      jobId: job.id,
      connectorId: job.connectorId,
      status: "RUNNING",
      triggeredBy: "SCHEDULER",
      startedAt: new Date().toISOString(),
    });

    console.error(`[scheduler] Running job "${job.name}" (connector: ${job.connectorId}, run: ${run.id})`);
    await this.executeRunLogic(job, run.id);
  }

  private async executeJobInBackground(job: ScheduledJob, runId: string): Promise<void> {
    await this.executeRunLogic(job, runId);
  }

  private async executeRunLogic(job: ScheduledJob, runId: string): Promise<void> {
    const start = Date.now();

    try {
      // Step 1: Load old snapshot from disk BEFORE discovery overwrites it
      const oldDb = this.manager.getLastDiscoverySnapshot(job.connectorId);

      // Step 2: Run discovery (with timeout)
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      const discoveryResult = await Promise.race([
        this.manager.discoverMetadata(job.connectorId),
        new Promise<never>((_, reject) => {
          timeoutTimer = setTimeout(() => reject(new Error(`Job timed out after ${job.timeoutSeconds}s`)), job.timeoutSeconds * 1000);
        }),
      ]);
      if (timeoutTimer) clearTimeout(timeoutTimer);

      // Step 3: Load new discovery result
      const newDb = this.manager.getDiscoveredSchema(job.connectorId);
      if (!newDb) {
        throw new Error("Discovery completed but no cached result found");
      }

      // Build discovery audit
      const discoverySummary: DiscoveryAudit = {
        schemasFound: discoveryResult.schemasFound,
        tablesFound: discoveryResult.tablesFound,
        viewsFound: discoveryResult.viewsFound,
        columnsFound: discoveryResult.columnsFound,
        foreignKeysFound: discoveryResult.foreignKeysFound,
        indexesFound: discoveryResult.indexesFound,
        discoveryDurationMs: discoveryResult.durationMs,
      };

      // Step 4: Compute diff
      const diff = oldDb ? compareSchemas(oldDb, newDb) : allAddedDiff(newDb);

      // Step 5: If no changes, record and return
      if (!diff.hasChanges) {
        this.store.updateRun(runId, {
          status: "NO_CHANGES",
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - start,
          discoverySummary,
          diff,
        });
        console.error(`[scheduler] Job "${job.name}" — no schema changes detected`);
        return;
      }

      // Step 6: Push delta if enabled
      let ingestionResult = undefined;
      if (job.pushChanges) {
        const clientConfig: IngestionClientConfig = {
          baseUrl: this.ingestionConfig?.baseUrl ?? this.defaultIngestUrl,
          apiKey: this.ingestionConfig?.apiKey,
          timeoutMs: this.ingestionConfig?.timeoutMs,
        };

        const connectorConfig = this.manager.getConnectorConfig(job.connectorId)!;
        ingestionResult = await buildAndPushDelta(
          job.connectorId, connectorConfig.type, newDb, oldDb, diff, clientConfig,
        );
      }

      this.store.updateRun(runId, {
        status: "COMPLETED",
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - start,
        discoverySummary,
        diff,
        ingestionResult,
      });

      const s = diff.summary;
      console.error(
        `[scheduler] Job "${job.name}" completed — ` +
        `+${s.tablesAdded} ~${s.tablesModified} -${s.tablesDropped} tables, ` +
        `+${s.columnsAdded} ~${s.columnsModified} -${s.columnsDropped} columns` +
        (ingestionResult ? ` → pushed ${ingestionResult.created}c/${ingestionResult.updated}u/${ingestionResult.deleted}d` : ""),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.includes("timed out");
      this.store.updateRun(runId, {
        status: isTimeout ? "TIMED_OUT" : "FAILED",
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - start,
        error: msg,
      });
      console.error(`[scheduler] Job "${job.name}" ${isTimeout ? "timed out" : "failed"}: ${msg}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Private — Schedule helpers
  // ---------------------------------------------------------------------------

  private advanceNextRun(job: ScheduledJob): void {
    let next: Date;
    if (job.scheduleType === "daily" && job.dailyRunTime) {
      next = this.getNextDailyRunTime(job.dailyRunTime);
    } else {
      next = new Date(Date.now() + (job.intervalSeconds ?? 3600) * 1000);
    }
    this.store.advanceNextRun(job.id, next.toISOString());
  }

  private getNextDailyRunTime(timeStr: string): Date {
    const parts = timeStr.split(":");
    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      console.error(`[scheduler] Invalid daily run time: "${timeStr}", defaulting to 02:00`);
      return this.getNextDailyRunTime("02:00");
    }
    const now = new Date();
    const target = new Date(now);
    target.setHours(hours, minutes, 0, 0);
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    return target;
  }
}
