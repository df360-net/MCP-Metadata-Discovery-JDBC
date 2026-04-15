/**
 * Scheduler Routes — REST API for managing scheduled discovery jobs.
 */

import { Router } from "express";
import { z } from "zod";
import type { SchedulerStore } from "./store.js";
import type { SchedulerEngine } from "./engine.js";

const JobCreateSchema = z.object({
  connectorId: z.string().min(1),
  name: z.string().min(1).max(100),
  scheduleType: z.enum(["interval", "daily"]),
  intervalSeconds: z.number().int().min(60).max(86400).optional(),
  dailyRunTime: z.string().regex(/^\d{2}:\d{2}$/).refine(
    (v) => { const [h, m] = v.split(":").map(Number); return h >= 0 && h <= 23 && m >= 0 && m <= 59; },
    { message: "dailyRunTime must be a valid HH:MM (00:00–23:59)" },
  ).optional(),
  timeoutSeconds: z.number().int().min(30).max(3600).default(600),
  pushChanges: z.boolean().default(true),
  isEnabled: z.boolean().default(true),
}).refine(
  (d) => d.scheduleType === "interval" ? !!d.intervalSeconds : !!d.dailyRunTime,
  { message: "interval mode requires intervalSeconds; daily mode requires dailyRunTime" },
);

const JobUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  scheduleType: z.enum(["interval", "daily"]).optional(),
  intervalSeconds: z.number().int().min(60).max(86400).optional(),
  dailyRunTime: z.string().regex(/^\d{2}:\d{2}$/).refine(
    (v) => { const [h, m] = v.split(":").map(Number); return h >= 0 && h <= 23 && m >= 0 && m <= 59; },
    { message: "dailyRunTime must be a valid HH:MM (00:00–23:59)" },
  ).optional(),
  timeoutSeconds: z.number().int().min(30).max(3600).optional(),
  pushChanges: z.boolean().optional(),
  isEnabled: z.boolean().optional(),
});

export function createSchedulerRouter(store: SchedulerStore, engine: SchedulerEngine): Router {
  const router = Router();

  // GET /api/scheduler/jobs — list all jobs with latest run
  router.get("/jobs", (_req, res) => {
    const jobs = store.listJobs();
    const result = jobs.map((job) => {
      const latestRun = store.getLatestRun(job.id);
      return { ...job, latestRun: latestRun ? { id: latestRun.id, status: latestRun.status, startedAt: latestRun.startedAt, durationMs: latestRun.durationMs, diff: latestRun.diff ? { hasChanges: latestRun.diff.hasChanges, summary: latestRun.diff.summary } : undefined } : undefined };
    });
    res.json(result);
  });

  // GET /api/scheduler/jobs/:id — get single job
  router.get("/jobs/:id", (req, res) => {
    const job = store.getJob(req.params.id);
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }
    const latestRun = store.getLatestRun(job.id);
    res.json({ ...job, latestRun });
  });

  // POST /api/scheduler/jobs — create job
  router.post("/jobs", (req, res) => {
    const parsed = JobCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      return;
    }

    const data = parsed.data;

    // Calculate initial nextRunAt
    let nextRunAt: string;
    if (data.scheduleType === "daily" && data.dailyRunTime) {
      const [h, m] = data.dailyRunTime.split(":").map(Number);
      const target = new Date();
      target.setHours(h, m, 0, 0);
      if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1);
      nextRunAt = target.toISOString();
    } else {
      nextRunAt = new Date(Date.now() + (data.intervalSeconds ?? 3600) * 1000).toISOString();
    }

    const job = store.createJob({ ...data, nextRunAt });
    res.status(201).json(job);
  });

  // PUT /api/scheduler/jobs/:id — update job
  router.put("/jobs/:id", (req, res) => {
    const parsed = JobUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      return;
    }

    const patch = parsed.data;

    // Recalculate nextRunAt if schedule parameters changed
    const existing = store.getJob(req.params.id);
    if (!existing) { res.status(404).json({ error: "Job not found" }); return; }

    const schedType = patch.scheduleType ?? existing.scheduleType;
    const interval = patch.intervalSeconds ?? existing.intervalSeconds;
    const dailyTime = patch.dailyRunTime ?? existing.dailyRunTime;
    const scheduleChanged = patch.scheduleType !== undefined || patch.intervalSeconds !== undefined || patch.dailyRunTime !== undefined;

    // Validate consistency: if switching to interval, intervalSeconds must be available
    if (schedType === "interval" && !interval) {
      res.status(400).json({ error: "interval mode requires intervalSeconds" });
      return;
    }
    if (schedType === "daily" && !dailyTime) {
      res.status(400).json({ error: "daily mode requires dailyRunTime" });
      return;
    }

    let nextRunAt: string | undefined;
    if (scheduleChanged) {
      if (schedType === "daily" && dailyTime) {
        const [h, m] = dailyTime.split(":").map(Number);
        const target = new Date();
        target.setHours(h, m, 0, 0);
        if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1);
        nextRunAt = target.toISOString();
      } else if (schedType === "interval" && interval) {
        nextRunAt = new Date(Date.now() + interval * 1000).toISOString();
      }
    }

    const updated = store.updateJob(req.params.id, { ...patch, ...(nextRunAt ? { nextRunAt } : {}) });
    if (!updated) { res.status(404).json({ error: "Job not found" }); return; }
    res.json(updated);
  });

  // DELETE /api/scheduler/jobs/:id — delete job
  router.delete("/jobs/:id", (req, res) => {
    const deleted = store.deleteJob(req.params.id);
    if (!deleted) { res.status(404).json({ error: "Job not found" }); return; }
    res.json({ ok: true });
  });

  // POST /api/scheduler/jobs/:id/trigger — manually trigger
  router.post("/jobs/:id/trigger", async (req, res) => {
    try {
      const runId = await engine.triggerJob(req.params.id);
      if (!runId) { res.status(404).json({ error: "Job or connector not found" }); return; }
      res.json({ ok: true, runId });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // GET /api/scheduler/jobs/:id/runs — list runs for a job
  router.get("/jobs/:id/runs", (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);
    const runs = store.listRuns(req.params.id, limit);
    res.json(runs);
  });

  // GET /api/scheduler/runs/:id — get single run with full audit
  router.get("/runs/:id", (req, res) => {
    const run = store.getRun(req.params.id);
    if (!run) { res.status(404).json({ error: "Run not found" }); return; }
    res.json(run);
  });

  return router;
}
