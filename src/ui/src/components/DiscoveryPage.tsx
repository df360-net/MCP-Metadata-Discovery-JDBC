import { useState } from "react";
import { useFetch, apiPost } from "../hooks/useApi.js";
import type { ConnectorSummary, DiscoveredDatabase, DiscoveredTable, DiscoveryRunSummary } from "../types.js";

export function DiscoveryPage() {
  const { data: connectors, refetch } = useFetch<ConnectorSummary[]>("/api/connectors");
  const [discovering, setDiscovering] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, DiscoveryRunSummary>>({});
  const [viewSchema, setViewSchema] = useState<string | null>(null);
  const [schemaData, setSchemaData] = useState<DiscoveredDatabase | null>(null);
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set());
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [pushing, setPushing] = useState<string | null>(null);
  const [pushResults, setPushResults] = useState<Record<string, { totalCreated: number; totalUpdated: number; totalFailed: number; durationMs: number }>>({});
  const [error, setError] = useState<string | null>(null);

  const handlePush = async (id: string) => {
    setPushing(id);
    setError(null);
    try {
      const result = await apiPost<{ totalCreated: number; totalUpdated: number; totalFailed: number; durationMs: number }>(`/api/connectors/${id}/push`);
      setPushResults((prev) => ({ ...prev, [id]: result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPushing(null);
    }
  };

  const handleDiscover = async (id: string) => {
    setDiscovering(id);
    setError(null);
    try {
      const summary = await apiPost<DiscoveryRunSummary>(`/api/connectors/${id}/discover`);
      setSummaries((prev) => ({ ...prev, [id]: summary }));
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDiscovering(null);
    }
  };

  const handleViewSchema = async (id: string) => {
    if (viewSchema === id) {
      setViewSchema(null);
      setSchemaData(null);
      return;
    }
    setViewSchema(id);
    setSchemaData(null);
    try {
      const res = await fetch(`/api/connectors/${id}/schema`);
      if (!res.ok) throw new Error("No cached discovery");
      const data = await res.json();
      setSchemaData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggleSchema = (key: string) => {
    setExpandedSchemas((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const toggleTable = (key: string) => {
    setExpandedTables((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const renderTable = (t: DiscoveredTable, schemaName: string) => {
    const key = `${schemaName}.${t.tableName}`;
    const isExpanded = expandedTables.has(key);
    const pkCols = new Set(t.primaryKey?.columns ?? []);
    const fkCols = new Set(t.foreignKeys.flatMap((fk) => fk.columns));

    return (
      <div key={key} className="table-item">
        <div className="table-item-header" onClick={() => toggleTable(key)}>
          <div className={`table-icon ${t.tableType === "TABLE" ? "tbl" : "view"}`}>
            {t.tableType === "TABLE" ? "T" : "V"}
          </div>
          <span>{t.tableName}</span>
          <span className="table-meta">
            {t.columns.length} cols
            {t.estimatedRowCount != null && ` | ~${t.estimatedRowCount.toLocaleString()} rows`}
          </span>
          <span className="expand-icon">{isExpanded ? "\u25BC" : "\u25B6"}</span>
        </div>
        {isExpanded && (
          <div className="table-detail">
            <table className="columns-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Column</th>
                  <th>Type</th>
                  <th>Nullable</th>
                  <th>Default</th>
                  <th>Comment</th>
                </tr>
              </thead>
              <tbody>
                {t.columns.map((col) => (
                  <tr key={col.columnName} className={col.isPrimaryKey ? "pk-row" : ""}>
                    <td style={{ color: "#aaa", width: 30 }}>{col.ordinalPosition}</td>
                    <td>
                      {col.columnName}
                      {pkCols.has(col.columnName) && <span className="badge-mini pk">PK</span>}
                      {fkCols.has(col.columnName) && <span className="badge-mini fk">FK</span>}
                    </td>
                    <td><code className="type-code">{col.fullDataType}</code></td>
                    <td>{col.isNullable ? "YES" : "NO"}</td>
                    <td style={{ fontSize: 11, color: "#888" }}>{col.columnDefault ?? ""}</td>
                    <td style={{ fontSize: 11, color: "#888", maxWidth: 150 }}>{col.columnComment ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {t.foreignKeys.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <h4 style={{ fontSize: 12, textTransform: "uppercase", color: "#666", marginBottom: 4 }}>Foreign Keys</h4>
                {t.foreignKeys.map((fk) => (
                  <div key={fk.constraintName} style={{ fontSize: 12, padding: "4px 0", borderBottom: "1px solid #f5f5f5" }}>
                    <code style={{ color: "#7c3aed" }}>{fk.constraintName}</code>:
                    {" "}{fk.columns.join(", ")} &rarr; {fk.referencedSchema}.{fk.referencedTable} ({fk.referencedColumns.join(", ")})
                  </div>
                ))}
              </div>
            )}

            {t.indexes.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <h4 style={{ fontSize: 12, textTransform: "uppercase", color: "#666", marginBottom: 4 }}>Indexes</h4>
                {t.indexes.map((idx) => (
                  <div key={idx.indexName} style={{ fontSize: 12, padding: "4px 0", borderBottom: "1px solid #f5f5f5" }}>
                    <code style={{ color: "#7c3aed" }}>{idx.indexName}</code>
                    {idx.isUnique && <span className="badge-mini">UNIQUE</span>}
                    : {idx.columns.join(", ")}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="disc-page">
      <div className="disc-header">
        <h2>Discovery</h2>
        <p className="disc-subtitle">Run metadata discovery on your database connectors</p>
      </div>

      {error && <div className="error-msg">{error} <button onClick={() => setError(null)} aria-label="Dismiss error">dismiss</button></div>}

      {connectors?.map((c) => {
        const summary = summaries[c.id];
        return (
          <div key={c.id} className="disc-connector-card">
            <div className="disc-connector-header">
              <div className="disc-connector-info">
                <div className="conn-icon">{c.type.slice(0, 4)}</div>
                <div>
                  <div className="disc-connector-name">{c.id}</div>
                  <div style={{ fontSize: 13, color: "#64748b" }}>{c.type} &middot; {c.host}:{c.port}/{c.database}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="conn-btn" onClick={() => handleDiscover(c.id)} disabled={discovering === c.id}>
                  {discovering === c.id ? "Discovering..." : "Discover"}
                </button>
                {c.hasCachedDiscovery && (
                  <button className="conn-btn" onClick={() => handleViewSchema(c.id)}>
                    {viewSchema === c.id ? "Hide Schema" : "View Schema"}
                  </button>
                )}
                {c.hasCachedDiscovery && (
                  <button className="conn-btn" onClick={() => handlePush(c.id)} disabled={pushing === c.id} style={{ borderColor: "#86efac", color: "#166534" }}>
                    {pushing === c.id ? "Pushing..." : "Push to Ingest"}
                  </button>
                )}
                {c.hasCachedDiscovery && (
                  <a className="conn-btn" href={`/api/connectors/${c.id}/schema?format=csv`} download style={{ textDecoration: "none", borderColor: "#93c5fd", color: "#1e40af" }}>
                    Export CSV
                  </a>
                )}
              </div>
            </div>

            {summary && (
              <div className="disc-summary">
                <div className="disc-stat"><span className="disc-stat-value">{summary.schemasFound}</span><span className="disc-stat-label">Schemas</span></div>
                <div className="disc-stat"><span className="disc-stat-value">{summary.tablesFound}</span><span className="disc-stat-label">Tables</span></div>
                <div className="disc-stat"><span className="disc-stat-value">{summary.viewsFound}</span><span className="disc-stat-label">Views</span></div>
                <div className="disc-stat"><span className="disc-stat-value">{summary.columnsFound}</span><span className="disc-stat-label">Columns</span></div>
                <div className="disc-stat"><span className="disc-stat-value">{summary.foreignKeysFound}</span><span className="disc-stat-label">FKs</span></div>
                <div className="disc-stat"><span className="disc-stat-value">{summary.indexesFound}</span><span className="disc-stat-label">Indexes</span></div>
                <div className="disc-stat"><span className="disc-stat-value">{(summary.durationMs / 1000).toFixed(1)}s</span><span className="disc-stat-label">Duration</span></div>
              </div>
            )}

            {pushResults[c.id] && (
              <div className="disc-summary" style={{ background: "#f0fdf4" }}>
                <div className="disc-stat"><span className="disc-stat-value" style={{ color: "#166534" }}>{pushResults[c.id].totalCreated}</span><span className="disc-stat-label">Created</span></div>
                <div className="disc-stat"><span className="disc-stat-value" style={{ color: "#1d4ed8" }}>{pushResults[c.id].totalUpdated}</span><span className="disc-stat-label">Updated</span></div>
                <div className="disc-stat"><span className="disc-stat-value" style={{ color: pushResults[c.id].totalFailed > 0 ? "#dc2626" : "#64748b" }}>{pushResults[c.id].totalFailed}</span><span className="disc-stat-label">Failed</span></div>
                <div className="disc-stat"><span className="disc-stat-value">{(pushResults[c.id].durationMs / 1000).toFixed(1)}s</span><span className="disc-stat-label">Push Time</span></div>
              </div>
            )}

            {c.lastDiscoveredAt && !summary && (
              <div style={{ fontSize: 12, color: "#94a3b8" }}>
                Last discovered: {(() => { const d = new Date(c.lastDiscoveredAt); return isNaN(d.getTime()) ? "Unknown" : d.toLocaleString(); })()}
              </div>
            )}

            {viewSchema === c.id && schemaData && (
              <div className="schema-tree">
                {schemaData.schemas.map((s) => {
                  const sKey = `${c.id}.${s.schemaName}`;
                  const isExpanded = expandedSchemas.has(sKey);
                  return (
                    <div key={sKey} className="schema-item">
                      <div className="schema-item-header" onClick={() => toggleSchema(sKey)}>
                        <span className="expand-icon">{isExpanded ? "\u25BC" : "\u25B6"}</span>
                        <strong>{s.schemaName}</strong>
                        <span className="table-meta">{s.tables.length} tables, {s.views.length} views</span>
                      </div>
                      {isExpanded && (
                        <div>
                          {s.tables.map((t) => renderTable(t, s.schemaName))}
                          {s.views.map((t) => renderTable(t, s.schemaName))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {connectors?.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px", color: "#94a3b8" }}>
          No connectors configured. Go to Connectors page to add one.
        </div>
      )}
    </div>
  );
}
