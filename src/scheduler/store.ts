/**
 * Scheduler Store — JSONL-based persistence for scheduled jobs and runs.
 * Adapted from mcp-asksql/src/scheduler/store.ts.
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { ScheduledJob, JobRun } from "./types.js";

export class SchedulerStore {
  private jobsPath: string;
  private runsPath: string;

  constructor(dataDir: string) {
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    this.jobsPath = resolve(dataDir, "scheduler-jobs.jsonl");
    this.runsPath = resolve(dataDir, "scheduler-runs.jsonl");
  }

  // ── Jobs ─────────────────────────────────────────

  listJobs(): ScheduledJob[] {
    return this.readJsonl<ScheduledJob>(this.jobsPath);
  }

  getJob(id: string): ScheduledJob | undefined {
    return this.listJobs().find((j) => j.id === id);
  }

  createJob(data: Omit<ScheduledJob, "id" | "createdAt" | "updatedAt">): ScheduledJob {
    const now = new Date().toISOString();
    const job: ScheduledJob = { id: randomUUID(), ...data, createdAt: now, updatedAt: now };
    const all = this.listJobs();
    all.push(job);
    this.writeJsonl(this.jobsPath, all);
    return job;
  }

  updateJob(
    id: string,
    data: Partial<Pick<ScheduledJob, "name" | "scheduleType" | "intervalSeconds" | "dailyRunTime" | "timeoutSeconds" | "pushChanges" | "isEnabled" | "nextRunAt">>,
  ): ScheduledJob | undefined {
    const all = this.listJobs();
    const idx = all.findIndex((j) => j.id === id);
    if (idx === -1) return undefined;
    Object.assign(all[idx], data, { updatedAt: new Date().toISOString() });
    this.writeJsonl(this.jobsPath, all);
    return all[idx];
  }

  deleteJob(id: string): boolean {
    const all = this.listJobs();
    const filtered = all.filter((j) => j.id !== id);
    if (filtered.length === all.length) return false;
    this.writeJsonl(this.jobsPath, filtered);
    return true;
  }

  advanceNextRun(id: string, nextRunAt: string): void {
    const all = this.listJobs();
    const idx = all.findIndex((j) => j.id === id);
    if (idx !== -1) {
      all[idx].nextRunAt = nextRunAt;
      all[idx].updatedAt = new Date().toISOString();
      this.writeJsonl(this.jobsPath, all);
    }
  }

  findDueJobs(): ScheduledJob[] {
    const now = Date.now();
    return this.listJobs().filter((j) => j.isEnabled && new Date(j.nextRunAt).getTime() <= now);
  }

  // ── Runs ─────────────────────────────────────────

  listRuns(jobId?: string, limit = 20): JobRun[] {
    let runs = this.readJsonl<JobRun>(this.runsPath);
    if (jobId) runs = runs.filter((r) => r.jobId === jobId);
    const safeTime = (s: string) => { const t = new Date(s).getTime(); return isNaN(t) ? 0 : t; };
    runs.sort((a, b) => safeTime(b.startedAt) - safeTime(a.startedAt));
    return runs.slice(0, limit);
  }

  getRun(id: string): JobRun | undefined {
    return this.readJsonl<JobRun>(this.runsPath).find((r) => r.id === id);
  }

  createRun(data: Omit<JobRun, "id">): JobRun {
    const run: JobRun = { id: randomUUID(), ...data };
    const all = this.readJsonl<JobRun>(this.runsPath);
    all.push(run);
    this.writeJsonl(this.runsPath, all);
    return run;
  }

  updateRun(
    id: string,
    data: Partial<Pick<JobRun, "status" | "completedAt" | "durationMs" | "discoverySummary" | "diff" | "ingestionResult" | "error">>,
  ): void {
    const all = this.readJsonl<JobRun>(this.runsPath);
    const idx = all.findIndex((r) => r.id === id);
    if (idx === -1) {
      console.warn(`[scheduler-store] updateRun: run ${id} not found, update skipped`);
      return;
    }
    Object.assign(all[idx], data);
    this.writeJsonl(this.runsPath, all);
  }

  recoverOrphanedRuns(): number {
    const all = this.readJsonl<JobRun>(this.runsPath);
    let recovered = 0;
    const now = new Date().toISOString();
    for (const run of all) {
      if (run.status === "RUNNING") {
        run.status = "FAILED";
        run.error = "Orphaned run recovered on startup";
        run.completedAt = now;
        if (run.startedAt) {
          run.durationMs = Date.now() - new Date(run.startedAt).getTime();
        }
        recovered++;
      }
    }
    if (recovered > 0) this.writeJsonl(this.runsPath, all);
    return recovered;
  }

  getLatestRun(jobId: string): JobRun | undefined {
    const runs = this.readJsonl<JobRun>(this.runsPath)
      .filter((r) => r.jobId === jobId)
      .sort((a, b) => { const t = (s: string) => { const v = new Date(s).getTime(); return isNaN(v) ? 0 : v; }; return t(b.startedAt) - t(a.startedAt); });
    return runs[0];
  }

  // ── JSONL helpers ────────────────────────────────

  private readJsonl<T>(path: string): T[] {
    if (!existsSync(path)) return [];
    const content = readFileSync(path, "utf-8").trim();
    if (!content) return [];
    const items: T[] = [];
    for (const line of content.split("\n").filter((l) => l.trim())) {
      try {
        items.push(JSON.parse(line) as T);
      } catch {
        console.warn(`[scheduler-store] Skipped malformed line in ${path}: ${line.slice(0, 100)}`);
      }
    }
    return items;
  }

  private writeJsonl<T>(path: string, items: T[]): void {
    const content = items.map((i) => JSON.stringify(i)).join("\n") + (items.length > 0 ? "\n" : "");
    const tmpPath = path + ".tmp";
    writeFileSync(tmpPath, content, "utf-8");
    renameSync(tmpPath, path);
  }
}
