import { useState, useEffect } from "react";
import type { DatabaseType } from "../types.js";

// Supported database types: 10 via JDBC sidecar + Iceberg via REST.
// TRINO and CLICKHOUSE are planned but not yet supported.
const DB_TYPES: DatabaseType[] = [
  "POSTGRESQL", "MYSQL", "MSSQL", "ORACLE", "SNOWFLAKE",
  "BIGQUERY", "REDSHIFT", "DATABRICKS", "DREMIO", "ICEBERG", "TERADATA",
];

const DEFAULT_PORTS: Record<string, number> = {
  POSTGRESQL: 5432, MYSQL: 3306, MSSQL: 1433, ORACLE: 1521,
  SNOWFLAKE: 443, BIGQUERY: 443, REDSHIFT: 5439, DATABRICKS: 443,
  DREMIO: 9047, ICEBERG: 8181, TERADATA: 1025,
};

interface Props {
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
  initial?: Record<string, unknown>;
}

export function ConnectorFormModal({ onClose, onSave, initial }: Props) {
  const [form, setForm] = useState<Record<string, string>>({
    id: (initial?.id as string) ?? "",
    type: (initial?.type as string) ?? "POSTGRESQL",
    host: (initial?.host as string) ?? "localhost",
    port: String(initial?.port ?? DEFAULT_PORTS.POSTGRESQL),
    user: (initial?.user as string) ?? "",
    password: (initial?.password as string) ?? "",
    database: (initial?.database as string) ?? "",
    schemas: (initial?.schemas as string[])?.join(", ") ?? "",
  });

  const set = (key: string, val: string) => {
    const next = { ...form, [key]: val };
    if (key === "type" && !initial) {
      next.port = String(DEFAULT_PORTS[val] ?? 5432);
    }
    setForm(next);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSave = () => {
    const schemas = form.schemas.split(",").map((s) => s.trim()).filter(Boolean);
    onSave({
      id: form.id,
      type: form.type,
      host: form.host,
      port: Number(form.port),
      user: form.user,
      password: form.password,
      database: form.database,
      ...(schemas.length > 0 ? { schemas } : {}),
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="form-modal-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="form-modal-title">{initial ? "Edit Connector" : "Add Connector"}</h3>

        <label htmlFor="cf-id">Connector ID</label>
        <input id="cf-id" value={form.id} onChange={(e) => set("id", e.target.value)} disabled={!!initial} placeholder="my-postgres" />

        <label htmlFor="cf-type">Database Type</label>
        <select id="cf-type" value={form.type} onChange={(e) => set("type", e.target.value)}>
          {DB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>

        <label htmlFor="cf-host">Host</label>
        <input id="cf-host" value={form.host} onChange={(e) => set("host", e.target.value)} placeholder="localhost" />

        <label htmlFor="cf-port">Port</label>
        <input id="cf-port" type="number" value={form.port} onChange={(e) => set("port", e.target.value)} min={1} max={65535} />

        <label htmlFor="cf-user">User</label>
        <input id="cf-user" value={form.user} onChange={(e) => set("user", e.target.value)} placeholder="postgres" />

        <label htmlFor="cf-password">Password</label>
        <input id="cf-password" type="password" value={form.password} onChange={(e) => set("password", e.target.value)} />

        <label htmlFor="cf-database">Database</label>
        <input id="cf-database" value={form.database} onChange={(e) => set("database", e.target.value)} placeholder="mydb" />

        <label htmlFor="cf-schemas">Schemas (comma-separated, optional)</label>
        <input id="cf-schemas" value={form.schemas} onChange={(e) => set("schemas", e.target.value)} placeholder="public, dbo" />

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={handleSave} disabled={!form.id || !form.host || !form.port || !form.database}>
            {initial ? "Update" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
