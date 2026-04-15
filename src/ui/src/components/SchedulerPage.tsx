import { useState, useEffect, useCallback } from "react";
import { useFetch, apiPost, apiPut, apiDelete } from "../hooks/useApi.js";
import type { ConnectorSummary } from "../types.js";

interface ScheduledJob {
  id: string;
  connectorId: string;
  name: string;
  scheduleType: "interval" | "daily";
  intervalSeconds?: number;
  dailyRunTime?: string;
  timeoutSeconds: number;
  pushChanges: boolean;
  isEnabled: boolean;
  nextRunAt: string;
  createdAt: string;
  latestRun?: JobRunSummary;
}

interface JobRunSummary {
  id: string;
  status: string;
  startedAt: string;
  durationMs?: number;
  diff?: { hasChanges: boolean; summary: DiffSummary };
}

interface DiffSummary {
  tablesAdded: number;
  tablesDropped: number;
  tablesModified: number;
  columnsAdded: number;
  columnsDropped: number;
  columnsModified: number;
}

interface JobRun {
  id: string;
  jobId: string;
  connectorId: string;
  status: string;
  triggeredBy: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  discoverySummary?: { schemasFound: number; tablesFound: number; viewsFound: number; columnsFound: number; foreignKeysFound: number; indexesFound: number; discoveryDurationMs: number };
  diff?: { hasChanges: boolean; summary: DiffSummary; schemas: SchemaDiffEntry[] };
  ingestionResult?: { created: number; updated: number; deleted: number; errors: string[]; durationMs: number; details: IngestionDetail[] };
  error?: string;
}

interface SchemaDiffEntry {
  schemaName: string;
  status: string;
  tables: TableDiffEntry[];
}

interface TableDiffEntry {
  tableName: string;
  status: string;
  columns: { columnName: string; status: string; changes?: { field: string; oldValue: unknown; newValue: unknown }[] }[];
}

interface IngestionDetail {
  operation: string;
  entityType: string;
  name: string;
  success: boolean;
  error?: string;
}

function EscapeHandler({ onEscape }: { onEscape: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onEscape(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onEscape]);
  return null;
}

export function SchedulerPage() {
  const { data: jobs, refetch: refetchJobs } = useFetch<ScheduledJob[]>("/api/scheduler/jobs");
  const { data: connectors } = useFetch<ConnectorSummary[]>("/api/connectors");
  const [showCreate, setShowCreate] = useState(false);
  const [editingJob, setEditingJob] = useState<ScheduledJob | null>(null);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, JobRun[]>>({});
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<JobRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState<string | null>(null);

  // Auto-poll when any job is RUNNING
  const hasRunning = jobs?.some((j) => j.latestRun?.status === "RUNNING");
  useEffect(() => {
    if (!hasRunning) return;
    let active = true;
    const timer = setInterval(() => { if (active) refetchJobs(); }, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [hasRunning, refetchJobs]);

  // Form state
  const defaultForm = {
    connectorId: "", name: "", scheduleType: "interval" as "interval" | "daily",
    intervalSeconds: "3600", dailyRunTime: "02:00", timeoutSeconds: "600", pushChanges: true,
  };
  const [form, setForm] = useState(defaultForm);

  const loadRuns = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/scheduler/jobs/${jobId}/runs?limit=10`);
      if (res.ok) {
        const data = await res.json();
        setRuns((prev) => ({ ...prev, [jobId]: data }));
      }
    } catch (err) {
      console.error("[SchedulerPage] Failed to load runs:", err);
    }
  }, []);

  const loadRunDetail = async (runId: string) => {
    try {
      const res = await fetch(`/api/scheduler/runs/${runId}`);
      if (res.ok) setRunDetail(await res.json());
    } catch (err) {
      console.error("[SchedulerPage] Failed to load run detail:", err);
    }
  };

  const openEdit = (job: ScheduledJob) => {
    setForm({
      connectorId: job.connectorId,
      name: job.name,
      scheduleType: job.scheduleType,
      intervalSeconds: String(job.intervalSeconds ?? 3600),
      dailyRunTime: job.dailyRunTime ?? "02:00",
      timeoutSeconds: String(job.timeoutSeconds),
      pushChanges: job.pushChanges,
    });
    setEditingJob(job);
  };

  const handleCreate = async () => {
    try {
      await apiPost("/api/scheduler/jobs", {
        connectorId: form.connectorId,
        name: form.name,
        scheduleType: form.scheduleType,
        intervalSeconds: form.scheduleType === "interval" ? Number(form.intervalSeconds) : undefined,
        dailyRunTime: form.scheduleType === "daily" ? form.dailyRunTime : undefined,
        timeoutSeconds: Number(form.timeoutSeconds),
        pushChanges: form.pushChanges,
        isEnabled: true,
      });
      setShowCreate(false);
      setForm(defaultForm);
      refetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleEdit = async () => {
    if (!editingJob) return;
    try {
      await apiPut(`/api/scheduler/jobs/${editingJob.id}`, {
        name: form.name,
        scheduleType: form.scheduleType,
        intervalSeconds: form.scheduleType === "interval" ? Number(form.intervalSeconds) : undefined,
        dailyRunTime: form.scheduleType === "daily" ? form.dailyRunTime : undefined,
        timeoutSeconds: Number(form.timeoutSeconds),
        pushChanges: form.pushChanges,
      });
      setEditingJob(null);
      refetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggle = async (job: ScheduledJob) => {
    try {
      await apiPut(`/api/scheduler/jobs/${job.id}`, { isEnabled: !job.isEnabled });
      refetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiDelete(`/api/scheduler/jobs/${id}`);
      refetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleTrigger = async (id: string) => {
    setTriggering(id);
    try {
      await apiPost(`/api/scheduler/jobs/${id}/trigger`);
      refetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTriggering(null);
    }
  };

  const toggleExpand = (jobId: string) => {
    if (expandedJob === jobId) {
      setExpandedJob(null);
    } else {
      setExpandedJob(jobId);
      loadRuns(jobId);
    }
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      COMPLETED: "#16a34a", NO_CHANGES: "#6b7280", RUNNING: "#d97706",
      FAILED: "#dc2626", TIMED_OUT: "#ea580c",
    };
    return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 9999, fontSize: 11, fontWeight: 600, color: "#fff", background: colors[status] ?? "#6b7280" }}>{status}</span>;
  };

  const changeSummary = (diff?: { hasChanges: boolean; summary: DiffSummary }) => {
    if (!diff || !diff.hasChanges) return <span style={{ color: "#6b7280" }}>—</span>;
    const s = diff.summary;
    const parts: JSX.Element[] = [];
    if (s.tablesAdded + s.columnsAdded > 0) parts.push(<span key="a" style={{ color: "#16a34a" }}>+{s.tablesAdded + s.columnsAdded}</span>);
    if (s.tablesModified + s.columnsModified > 0) parts.push(<span key="m" style={{ color: "#d97706" }}>~{s.tablesModified + s.columnsModified}</span>);
    if (s.tablesDropped + s.columnsDropped > 0) parts.push(<span key="d" style={{ color: "#dc2626" }}>-{s.tablesDropped + s.columnsDropped}</span>);
    return <span style={{ display: "flex", gap: 6 }}>{parts}</span>;
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0 }}>Scheduler</h2>
          <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 14 }}>Scheduled discovery, schema diff, and delta ingestion</p>
        </div>
        <button className="btn primary" onClick={() => setShowCreate(true)}>+ Add Job</button>
      </div>

      {error && <div className="error-banner" style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "8px 16px", borderRadius: 6, marginBottom: 16 }}>{error} <button onClick={() => setError(null)} aria-label="Dismiss error" style={{ marginLeft: 8, background: "none", border: "none", cursor: "pointer" }}>dismiss</button></div>}

      {/* Job list */}
      {jobs && jobs.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>
          No scheduled jobs yet. Click "+ Add Job" to create one.
        </div>
      )}

      {jobs?.map((job) => (
        <div key={job.id} className="card" style={{ marginBottom: 12, border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <label style={{ cursor: "pointer" }}>
                  <input type="checkbox" checked={job.isEnabled} onChange={() => handleToggle(job)} style={{ marginRight: 6 }} />
                </label>
                <strong style={{ fontSize: 15 }}>{job.name}</strong>
                {job.latestRun && statusBadge(job.latestRun.status)}
              </div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                {job.connectorId} &middot; {job.scheduleType === "daily" ? `Daily at ${job.dailyRunTime}` : `Every ${job.intervalSeconds}s`} &middot; Timeout: {job.timeoutSeconds}s &middot; Push: {job.pushChanges ? "Yes" : "No"}
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
                Next run: {(() => { if (!job.nextRunAt) return "—"; const d = new Date(job.nextRunAt); return isNaN(d.getTime()) ? "—" : d.toLocaleString(); })()}
                {job.latestRun && ` | Last: ${job.latestRun.durationMs ? (job.latestRun.durationMs / 1000).toFixed(1) + "s" : "—"} `}
                {job.latestRun && changeSummary(job.latestRun.diff)}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="conn-btn" onClick={() => handleTrigger(job.id)} disabled={triggering === job.id}>
                {triggering === job.id ? "Triggering..." : "Trigger Now"}
              </button>
              <button className="conn-btn" onClick={() => toggleExpand(job.id)}>
                {expandedJob === job.id ? "Hide Runs" : "Run History"}
              </button>
              <button className="conn-btn" onClick={() => openEdit(job)}>Edit</button>
              <button className="conn-btn" onClick={() => handleDelete(job.id)} style={{ color: "#dc2626", borderColor: "#fecaca" }}>Delete</button>
            </div>
          </div>

          {/* Expanded: Run history */}
          {expandedJob === job.id && (
            <div style={{ borderTop: "1px solid #e2e8f0", padding: 16, background: "#f8fafc" }}>
              <h4 style={{ margin: "0 0 8px" }}>Run History</h4>
              {!runs[job.id] || runs[job.id].length === 0 ? (
                <p style={{ color: "#94a3b8", fontSize: 13 }}>No runs yet.</p>
              ) : (
                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
                      <th style={{ textAlign: "left", padding: 4 }}>Time</th>
                      <th style={{ textAlign: "left", padding: 4 }}>Triggered</th>
                      <th style={{ textAlign: "left", padding: 4 }}>Status</th>
                      <th style={{ textAlign: "left", padding: 4 }}>Duration</th>
                      <th style={{ textAlign: "left", padding: 4 }}>Changes</th>
                      <th style={{ padding: 4 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs[job.id].map((run) => (
                      <tr key={run.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: 4 }}>{(() => { if (!run.startedAt) return "—"; const d = new Date(run.startedAt); return isNaN(d.getTime()) ? "—" : d.toLocaleString(); })()}</td>
                        <td style={{ padding: 4 }}>{run.triggeredBy}</td>
                        <td style={{ padding: 4 }}>{statusBadge(run.status)}</td>
                        <td style={{ padding: 4 }}>{run.durationMs ? (run.durationMs / 1000).toFixed(1) + "s" : "—"}</td>
                        <td style={{ padding: 4 }}>{changeSummary(run.diff)}</td>
                        <td style={{ padding: 4 }}>
                          <button style={{ fontSize: 11, cursor: "pointer", background: "none", border: "1px solid #cbd5e1", borderRadius: 4, padding: "2px 8px" }} onClick={() => { setExpandedRun(expandedRun === run.id ? null : run.id); loadRunDetail(run.id); }}>
                            {expandedRun === run.id ? "Hide" : "Details"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Run detail */}
              {expandedRun && runDetail && expandedRun === runDetail.id && (
                <div style={{ marginTop: 12, padding: 12, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 12 }}>
                  <h4 style={{ margin: "0 0 8px" }}>Run Detail — {runDetail.id.slice(0, 8)}</h4>

                  {runDetail.error && <div style={{ color: "#dc2626", marginBottom: 8 }}>Error: {runDetail.error}</div>}

                  {runDetail.discoverySummary && (
                    <div style={{ marginBottom: 8 }}>
                      <strong>Discovery:</strong> {runDetail.discoverySummary.schemasFound} schemas, {runDetail.discoverySummary.tablesFound} tables, {runDetail.discoverySummary.columnsFound} columns ({(runDetail.discoverySummary.discoveryDurationMs / 1000).toFixed(1)}s)
                    </div>
                  )}

                  {runDetail.diff && runDetail.diff.hasChanges && (
                    <div style={{ marginBottom: 8 }}>
                      <strong>Changes:</strong>
                      <div style={{ marginLeft: 12, marginTop: 4 }}>
                        {runDetail.diff.schemas.filter((s) => s.status !== "unchanged").map((schema) => (
                          <div key={schema.schemaName} style={{ marginBottom: 4 }}>
                            <span style={{ color: schema.status === "added" ? "#16a34a" : schema.status === "dropped" ? "#dc2626" : "#d97706" }}>
                              {schema.status === "added" ? "+" : schema.status === "dropped" ? "-" : "~"} SCHEMA {schema.schemaName}
                            </span>
                            <div style={{ marginLeft: 16 }}>
                              {schema.tables.filter((t) => t.status !== "unchanged").map((table) => (
                                <div key={table.tableName} style={{ marginBottom: 2 }}>
                                  <span style={{ color: table.status === "added" ? "#16a34a" : table.status === "dropped" ? "#dc2626" : "#d97706" }}>
                                    {table.status === "added" ? "+" : table.status === "dropped" ? "-" : "~"} TABLE {table.tableName}
                                  </span>
                                  {table.status === "modified" && (
                                    <div style={{ marginLeft: 16 }}>
                                      {table.columns.filter((c) => c.status !== "unchanged").map((col) => (
                                        <div key={col.columnName} style={{ color: col.status === "added" ? "#16a34a" : col.status === "dropped" ? "#dc2626" : "#d97706" }}>
                                          {col.status === "added" ? "+" : col.status === "dropped" ? "-" : "~"} {col.columnName}
                                          {col.changes && col.changes.map((ch, i) => (
                                            <span key={i} style={{ marginLeft: 6, color: "#64748b" }}>({ch.field}: {String(ch.oldValue)} → {String(ch.newValue)})</span>
                                          ))}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {runDetail.ingestionResult && (
                    <div>
                      <strong>Ingestion:</strong> {runDetail.ingestionResult.created} created, {runDetail.ingestionResult.updated} updated, {runDetail.ingestionResult.deleted} deleted ({(runDetail.ingestionResult.durationMs / 1000).toFixed(1)}s)
                      {runDetail.ingestionResult.errors.length > 0 && (
                        <div style={{ color: "#dc2626", marginTop: 4 }}>{runDetail.ingestionResult.errors.join("; ")}</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Create modal */}
      {showCreate && <EscapeHandler onEscape={() => { setShowCreate(false); setForm(defaultForm); }} />}
      {showCreate && (
        <div className="modal-overlay" onClick={() => { setShowCreate(false); setForm(defaultForm); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="sched-modal-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="sched-modal-title">Create Scheduled Job</h3>

            <label htmlFor="sj-connector">Connector</label>
            <select id="sj-connector" value={form.connectorId} onChange={(e) => setForm({ ...form, connectorId: e.target.value })}>
              <option value="">Select connector...</option>
              {connectors?.map((c) => <option key={c.id} value={c.id}>{c.id} ({c.type})</option>)}
            </select>

            <label htmlFor="sj-name">Job Name</label>
            <input id="sj-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nightly PG Discovery" />

            <label>Schedule Type</label>
            <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
              <label><input type="radio" name="schedType" checked={form.scheduleType === "interval"} onChange={() => setForm({ ...form, scheduleType: "interval" })} /> Interval</label>
              <label><input type="radio" name="schedType" checked={form.scheduleType === "daily"} onChange={() => setForm({ ...form, scheduleType: "daily" })} /> Daily</label>
            </div>

            {form.scheduleType === "interval" ? (
              <>
                <label htmlFor="sj-interval">Interval (seconds)</label>
                <input id="sj-interval" type="number" value={form.intervalSeconds} onChange={(e) => setForm({ ...form, intervalSeconds: e.target.value })} min={60} max={86400} />
              </>
            ) : (
              <>
                <label htmlFor="sj-runtime">Run Time (HH:MM)</label>
                <input id="sj-runtime" type="time" value={form.dailyRunTime} onChange={(e) => setForm({ ...form, dailyRunTime: e.target.value })} />
              </>
            )}

            <label htmlFor="sj-timeout">Timeout (seconds)</label>
            <input id="sj-timeout" type="number" value={form.timeoutSeconds} onChange={(e) => setForm({ ...form, timeoutSeconds: e.target.value })} min={30} max={3600} />

            <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
              <input type="checkbox" checked={form.pushChanges} onChange={(e) => setForm({ ...form, pushChanges: e.target.checked })} />
              Push changes to ingestion service
            </label>

            <div className="modal-actions">
              <button onClick={() => { setShowCreate(false); setForm(defaultForm); }}>Cancel</button>
              <button className="btn primary" onClick={handleCreate} disabled={!form.connectorId || !form.name}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editingJob && <EscapeHandler onEscape={() => { setEditingJob(null); setForm(defaultForm); }} />}
      {editingJob && (
        <div className="modal-overlay" onClick={() => { setEditingJob(null); setForm(defaultForm); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="sched-edit-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="sched-edit-title">Edit Job — {editingJob.name}</h3>

            <label htmlFor="ej-name">Job Name</label>
            <input id="ej-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />

            <label>Schedule Type</label>
            <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
              <label><input type="radio" name="editSchedType" checked={form.scheduleType === "interval"} onChange={() => setForm({ ...form, scheduleType: "interval" })} /> Interval</label>
              <label><input type="radio" name="editSchedType" checked={form.scheduleType === "daily"} onChange={() => setForm({ ...form, scheduleType: "daily" })} /> Daily</label>
            </div>

            {form.scheduleType === "interval" ? (
              <>
                <label htmlFor="ej-interval">Interval (seconds)</label>
                <input id="ej-interval" type="number" value={form.intervalSeconds} onChange={(e) => setForm({ ...form, intervalSeconds: e.target.value })} min={60} max={86400} />
              </>
            ) : (
              <>
                <label htmlFor="ej-runtime">Run Time (HH:MM)</label>
                <input id="ej-runtime" type="time" value={form.dailyRunTime} onChange={(e) => setForm({ ...form, dailyRunTime: e.target.value })} />
              </>
            )}

            <label htmlFor="ej-timeout">Timeout (seconds)</label>
            <input id="ej-timeout" type="number" value={form.timeoutSeconds} onChange={(e) => setForm({ ...form, timeoutSeconds: e.target.value })} min={30} max={3600} />

            <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
              <input type="checkbox" checked={form.pushChanges} onChange={(e) => setForm({ ...form, pushChanges: e.target.checked })} />
              Push changes to ingestion service
            </label>

            <div className="modal-actions">
              <button onClick={() => { setEditingJob(null); setForm(defaultForm); }}>Cancel</button>
              <button className="btn primary" onClick={handleEdit} disabled={!form.name}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
