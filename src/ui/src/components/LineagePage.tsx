import { useState } from "react";
import { useFetch } from "../hooks/useApi.js";
import type { ConnectorSummary, LineageEdge, LineageSummary } from "../types.js";

export function LineagePage() {
  const { data: connectors } = useFetch<ConnectorSummary[]>("/api/connectors");
  const { data: summaryData } = useFetch<LineageSummary>("/api/lineage/summary");
  const [connector, setConnector] = useState("");
  const [table, setTable] = useState("");
  const { data: lineageData, refetch } = useFetch<{ edgeCount: number; edges: LineageEdge[] }>(
    `/api/lineage?connector=${encodeURIComponent(connector)}&table=${encodeURIComponent(table)}`,
    [connector, table],
  );

  const [error, setError] = useState<string | null>(null);
  const [searchPattern, setSearchPattern] = useState("");
  const [searchConnector, setSearchConnector] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ connector: string; schema: string; table: string; column: string; dataType: string; fullDataType: string }> | null>(null);
  const [searching, setSearching] = useState(false);

  const handleSearch = async () => {
    if (!searchPattern) return;
    setSearching(true);
    try {
      const params = new URLSearchParams({ q: searchPattern });
      if (searchConnector) params.set("connector", searchConnector);
      const res = await fetch(`/api/search/columns?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `Search failed: ${res.statusText}`);
      }
      const data = await res.json();
      setSearchResults(data.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  /** Parse a PID like "COL@TABLE@SCHEMA@CONNECTOR" into readable parts */
  const parsePid = (pid: string) => {
    const parts = pid.split("@");
    if (parts.length >= 4) return { col: parts[0], table: parts[1], schema: parts[2], connector: parts.slice(3).join("@") };
    return { col: pid || "?", table: "?", schema: "?", connector: "?" };
  };

  return (
    <div className="lineage-page">
      <div className="lineage-header">
        <h2>Data Lineage</h2>
        <p className="lineage-subtitle">FK-based lineage edges and column search across discovered databases</p>
      </div>

      {error && <div className="error-banner" style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "8px 16px", borderRadius: 6, marginBottom: 16 }}>{error} <button onClick={() => setError(null)} aria-label="Dismiss error" style={{ marginLeft: 8, background: "none", border: "none", cursor: "pointer" }}>dismiss</button></div>}

      {/* Summary stats */}
      {summaryData && (
        <div className="stats-bar">
          <div className="stat"><span className="stat-value">{summaryData.totalRaw}</span><span className="stat-label">Total Raw</span></div>
          <div className="stat"><span className="stat-value">{summaryData.uniqueEdges}</span><span className="stat-label">Unique Edges</span></div>
          <div className="stat"><span className="stat-value">{summaryData.duplicatesRemoved}</span><span className="stat-label">Duplicates</span></div>
          <div className="stat"><span className="stat-value">{summaryData.crossAppEdges}</span><span className="stat-label">Cross-App</span></div>
          {Object.entries(summaryData.bySourceType).map(([type, count]) => (
            count > 0 && <div key={type} className="stat"><span className="stat-value">{count}</span><span className="stat-label">{type}</span></div>
          ))}
        </div>
      )}

      {/* Lineage filters */}
      <div className="lineage-filters">
        <select value={connector} onChange={(e) => setConnector(e.target.value)}>
          <option value="">All Connectors</option>
          {connectors?.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
        </select>
        <input placeholder="Filter by table name..." value={table} onChange={(e) => setTable(e.target.value)} />
      </div>

      {/* Lineage edges table */}
      {lineageData && lineageData.edges.length > 0 ? (
        <>
          <p style={{ fontSize: 13, color: "#64748b", marginBottom: 8 }}>{lineageData.edgeCount} edge(s)</p>
          <table className="table">
            <thead>
              <tr>
                <th>Source Column</th>
                <th>Source Table</th>
                <th>Source Schema</th>
                <th></th>
                <th>Target Column</th>
                <th>Target Table</th>
                <th>Target Schema</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {lineageData.edges.map((e) => {
                const src = parsePid(e.source_element_pid);
                const tgt = parsePid(e.target_element_pid);
                return (
                  <tr key={`${e.source_element_pid}|${e.target_element_pid}`}>
                    <td><strong>{src.col}</strong></td>
                    <td>{src.table}</td>
                    <td>{src.schema}</td>
                    <td style={{ color: "#3b82f6", fontWeight: 700 }}>&rarr;</td>
                    <td><strong>{tgt.col}</strong></td>
                    <td>{tgt.table}</td>
                    <td>{tgt.schema}</td>
                    <td><span className="badge blue">{e.source_type}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : (
        <div style={{ textAlign: "center", padding: "24px", color: "#94a3b8" }}>
          No lineage edges found. Run discovery first to extract FK-based lineage.
        </div>
      )}

      {/* Column search */}
      <div style={{ marginTop: 40 }}>
        <h3 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", marginBottom: 12 }}>Column Search</h3>
        <div className="search-bar">
          <select value={searchConnector} onChange={(e) => setSearchConnector(e.target.value)} style={{ flex: "none", width: 180 }}>
            <option value="">All Connectors</option>
            {connectors?.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
          </select>
          <input
            placeholder="Search columns by regex pattern (e.g., email, user_id, .*_at$)"
            value={searchPattern}
            onChange={(e) => setSearchPattern(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <button className="search-btn" onClick={handleSearch} disabled={searching || !searchPattern}>
            {searching ? "Searching..." : "Search"}
          </button>
        </div>

        {searchResults && searchResults.length > 0 && (
          <>
            <p style={{ fontSize: 13, color: "#64748b", marginBottom: 8 }}>{searchResults.length} match(es)</p>
            <table className="table">
              <thead>
                <tr>
                  <th>Connector</th>
                  <th>Schema</th>
                  <th>Table</th>
                  <th>Column</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {searchResults.map((r) => (
                  <tr key={`${r.connector}.${r.schema}.${r.table}.${r.column}`}>
                    <td>{r.connector}</td>
                    <td>{r.schema}</td>
                    <td>{r.table}</td>
                    <td><strong>{r.column}</strong></td>
                    <td><code className="type-code">{r.fullDataType}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {searchResults && searchResults.length === 0 && (
          <div style={{ textAlign: "center", padding: "16px", color: "#94a3b8" }}>No matching columns found.</div>
        )}
      </div>
    </div>
  );
}
