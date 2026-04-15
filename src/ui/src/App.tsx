import { useState, useEffect } from "react";
import { useFetch } from "./hooks/useApi.js";
import type { ServerHealth } from "./types.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { ConnectorsPage } from "./components/ConnectorsPage.js";
import { DiscoveryPage } from "./components/DiscoveryPage.js";
import { LineagePage } from "./components/LineagePage.js";
import { SchedulerPage } from "./components/SchedulerPage.js";

type Page = "connectors" | "discovery" | "lineage" | "scheduler";

function getPage(): Page {
  const hash = window.location.hash.replace("#", "");
  if (hash === "discovery" || hash === "lineage" || hash === "scheduler") return hash;
  return "connectors";
}

export function App() {
  const [page, setPage] = useState<Page>(getPage);
  const { data: health } = useFetch<ServerHealth>("/health");

  useEffect(() => {
    const handler = () => setPage(getPage());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  const nav = (p: Page) => { window.location.hash = p; };

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-brand">
          <div className="brand-icon">
            <svg width="22" height="22" fill="none" stroke="#fff" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 3 4 8 4s8-2 8-4V7" />
              <ellipse cx="12" cy="7" rx="8" ry="4" strokeWidth={2} />
              <path strokeLinecap="round" strokeWidth={2} d="M4 12c0 2 3 4 8 4s8-2 8-4" />
            </svg>
          </div>
          <div>
            <h1>MCP Metadata Discovery</h1>
            <p className="brand-subtitle">Schema Discovery &amp; Data Lineage</p>
          </div>
        </div>
        <div className="topbar-status">
          <span className={`dot ${health?.ok ? "green" : "red"}`} />
          {health ? `${health.connectors} connector(s) | ${health.activeSessions} session(s)` : "connecting..."}
        </div>
      </header>

      <div className="layout">
        <nav className="sidebar">
          <button className={page === "connectors" ? "active" : ""} onClick={() => nav("connectors")}>
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            Connectors
          </button>
          <button className={page === "discovery" ? "active" : ""} onClick={() => nav("discovery")}>
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            Discovery
          </button>
          <button className={page === "lineage" ? "active" : ""} onClick={() => nav("lineage")}>
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            Lineage
          </button>
          <button className={page === "scheduler" ? "active" : ""} onClick={() => nav("scheduler")}>
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            Scheduler
          </button>
        </nav>

        <main className="content">
          <ErrorBoundary>
            {page === "connectors" && <ConnectorsPage />}
            {page === "discovery" && <DiscoveryPage />}
            {page === "lineage" && <LineagePage />}
            {page === "scheduler" && <SchedulerPage />}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
