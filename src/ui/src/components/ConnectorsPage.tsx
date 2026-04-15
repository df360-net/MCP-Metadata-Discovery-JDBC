import { useState } from "react";
import { useFetch, apiPost, apiPut, apiDelete } from "../hooks/useApi.js";
import type { ConnectorSummary } from "../types.js";
import { ConnectorFormModal } from "./ConnectorFormModal.js";
import { ConfirmModal } from "./ConfirmModal.js";

export function ConnectorsPage() {
  const { data: connectors, refetch } = useFetch<ConnectorSummary[]>("/api/connectors");
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Record<string, unknown> | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { success: boolean; serverVersion?: string; latencyMs?: number; errorMessage?: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleAdd = async (data: Record<string, unknown>) => {
    try {
      await apiPost("/api/connectors", data);
      setShowModal(false);
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleEdit = async (data: Record<string, unknown>) => {
    if (!editId) return;
    try {
      await apiPut(`/api/connectors/${editId}`, data);
      setEditId(null);
      setEditData(null);
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiDelete(`/api/connectors/${id}`);
      setDeleteConfirmId(null);
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleTest = async (id: string) => {
    setTesting(id);
    try {
      const result = await apiPost<{ success: boolean; serverVersion?: string; latencyMs?: number; errorMessage?: string }>(`/api/connectors/${id}/test`);
      setTestResult((prev) => ({ ...prev, [id]: result }));
    } catch (err) {
      setTestResult((prev) => ({ ...prev, [id]: { success: false, errorMessage: err instanceof Error ? err.message : String(err) } }));
    } finally {
      setTesting(null);
    }
  };

  const openEdit = async (id: string) => {
    try {
      const res = await fetch(`/api/connectors/${id}`);
      if (!res.ok) throw new Error(`Failed to load connector: ${res.statusText}`);
      const data = await res.json();
      setEditData(data);
      setEditId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="conn-page">
      <div className="conn-header">
        <div>
          <h2>Connectors</h2>
          <p className="conn-subtitle">Manage database connections for metadata discovery</p>
        </div>
        <button className="conn-add-btn" onClick={() => setShowModal(true)}>
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Add Connector
        </button>
      </div>

      {error && <div className="error-msg">{error} <button onClick={() => setError(null)} aria-label="Dismiss error">dismiss</button></div>}

      <div className="conn-list">
        {connectors?.map((c) => {
          const tr = testResult[c.id];
          return (
            <div key={c.id} className="conn-card">
              <div className="conn-card-left">
                <div className="conn-icon">{c.type.slice(0, 4)}</div>
                <div className="conn-info">
                  <div className="conn-name">{c.id}</div>
                  <div className="conn-meta">
                    <span className="conn-type-badge">{c.type}</span>
                    <span className="conn-dot">&middot;</span>
                    {c.host}:{c.port}/{c.database}
                  </div>
                </div>
              </div>
              <div className="conn-card-right">
                {tr && (
                  <div className={`conn-status ${tr.success ? "connected" : "disconnected"}`}>
                    <span className="conn-status-dot" />
                    {tr.success ? `${tr.serverVersion?.slice(0, 30)} (${tr.latencyMs}ms)` : tr.errorMessage?.slice(0, 40)}
                  </div>
                )}
                {c.hasCachedDiscovery && (
                  <span className="badge green">discovered</span>
                )}
                <div className="conn-actions">
                  <button className="conn-btn" onClick={() => handleTest(c.id)} disabled={testing === c.id}>
                    {testing === c.id ? "Testing..." : "Test"}
                  </button>
                  <button className="conn-btn" onClick={() => openEdit(c.id)}>Edit</button>
                  <button className="conn-btn remove" onClick={() => setDeleteConfirmId(c.id)}>Remove</button>
                </div>
              </div>
            </div>
          );
        })}
        {connectors?.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px", color: "#94a3b8" }}>
            No connectors configured. Click "Add Connector" to get started.
          </div>
        )}
      </div>

      {showModal && <ConnectorFormModal onClose={() => setShowModal(false)} onSave={handleAdd} />}
      {editId && editData && <ConnectorFormModal onClose={() => { setEditId(null); setEditData(null); }} onSave={handleEdit} initial={editData} />}
      {deleteConfirmId && (
        <ConfirmModal
          title="Delete Connector"
          message={`Are you sure you want to delete connector '${deleteConfirmId}'? This action cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => handleDelete(deleteConfirmId)}
          onCancel={() => setDeleteConfirmId(null)}
        />
      )}
    </div>
  );
}
