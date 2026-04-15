/**
 * Generic Ingestion Client — pushes discovery results to any DCF-compatible API.
 *
 * The client is target-agnostic: set baseUrl to the local mock or the real DCF.
 *   - Local mock:  http://localhost:8090/api/v1/ingest
 *   - Real DCF:    https://your-ingestion-api.example.com/api/v1/ingest
 *
 * Methods:
 *   pushContainerWithEntities()  — push full schema (database + tables + columns)
 *   pushEntityWithElements()     — push a single table
 *   pushLineage()                — push FK lineage edges
 *   pushAll()                    — convenience: push all schemas + lineage for a connector
 */

import type { DiscoveredDatabase, DiscoveredTable, DatabaseType } from "../discovery/types.js";
import type { IngestionResponse } from "./types.js";
import { buildContainerPayloads, buildEntityPayload, buildLineagePayload } from "./payload-builder.js";

export interface IngestionClientConfig {
  /** Base URL of the ingestion API (e.g., "http://localhost:8090/api/v1/ingest") */
  baseUrl: string;
  /** Optional Bearer token for authentication (required for real DCF) */
  apiKey?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
}

export interface PushAllResult {
  containers: IngestionResponse[];
  lineage: IngestionResponse | null;
  lineageError?: string;
  totalCreated: number;
  totalUpdated: number;
  totalFailed: number;
  durationMs: number;
}

export class IngestionClient {
  private readonly _baseUrl: string;
  private apiKey?: string;
  private timeoutMs: number;

  constructor(config: IngestionClientConfig) {
    // Remove trailing slash
    this._baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 30000;
  }

  /** Public accessor for the base URL (used by delta-payload-builder for custom requests). */
  get baseUrl(): string {
    return this._baseUrl;
  }

  /**
   * Push a full schema (container + all entities + all elements) to the ingestion API.
   * Sends one request per schema in the discovered database.
   */
  async pushContainerWithEntities(
    connectorId: string,
    dbType: DatabaseType,
    db: DiscoveredDatabase,
  ): Promise<IngestionResponse[]> {
    const payloads = buildContainerPayloads(connectorId, dbType, db);
    const responses: IngestionResponse[] = [];

    for (const payload of payloads) {
      const resp = await this.post<IngestionResponse>(
        "/container-with-entities",
        payload,
      );
      responses.push(resp);
    }

    return responses;
  }

  /**
   * Push a single entity (table/view + columns) into an existing container.
   */
  async pushEntityWithElements(
    connectorId: string,
    dbType: DatabaseType,
    schemaName: string,
    table: DiscoveredTable,
  ): Promise<IngestionResponse> {
    const payload = buildEntityPayload(connectorId, dbType, schemaName, table);
    return this.post<IngestionResponse>("/entity-with-elements", payload);
  }

  /**
   * Push FK-based lineage edges.
   */
  async pushLineage(
    connectorId: string,
    dbType: DatabaseType,
    db: DiscoveredDatabase,
  ): Promise<IngestionResponse> {
    const payload = buildLineagePayload(connectorId, dbType, db);

    if (payload.edges.length === 0) {
      return {
        status: "completed",
        summary: { total: 0, created: 0, updated: 0, unchanged: 0, failed: 0 },
        results: [],
      };
    }

    return this.post<IngestionResponse>("/lineage", payload);
  }

  /**
   * Push everything for a connector: all schemas + lineage.
   */
  async pushAll(
    connectorId: string,
    dbType: DatabaseType,
    db: DiscoveredDatabase,
  ): Promise<PushAllResult> {
    const start = Date.now();

    // Push containers (schemas + tables + columns)
    const containers = await this.pushContainerWithEntities(connectorId, dbType, db);

    // Push lineage
    let lineage: IngestionResponse | null = null;
    let lineageError: string | undefined;
    try {
      lineage = await this.pushLineage(connectorId, dbType, db);
    } catch (err) {
      lineageError = err instanceof Error ? err.message : String(err);
      console.error(`[ingestion-client] Lineage push failed: ${lineageError}`);
    }

    // Aggregate stats
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalFailed = 0;

    for (const resp of containers) {
      totalCreated += resp.summary.created;
      totalUpdated += resp.summary.updated;
      totalFailed += resp.summary.failed;
    }
    if (lineage) {
      totalCreated += lineage.summary.created;
      totalUpdated += lineage.summary.updated;
      totalFailed += lineage.summary.failed;
    }

    return {
      containers,
      lineage,
      lineageError,
      totalCreated,
      totalUpdated,
      totalFailed,
      durationMs: Date.now() - start,
    };
  }

  // ---------------------------------------------------------------------------
  // Private HTTP helper
  // ---------------------------------------------------------------------------

  private async post<T>(path: string, body: unknown, retries = 2): Promise<T> {
    const url = `${this._baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        // Retry on transient server errors
        if (res.status >= 500 && attempt < retries) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise<void>(r => { const t = setTimeout(r, delay); if (typeof t === "object" && "unref" in t) t.unref(); });
          continue;
        }

        if (!res.ok) {
          // Consume the body defensively — if res.text() itself fails (rare:
          // disconnect mid-read), still produce a meaningful error without
          // letting an unconsumed body keep the connection alive.
          let errorBody: string;
          try {
            errorBody = await res.text();
          } catch {
            errorBody = "<response body unavailable>";
          }
          throw new Error(`Ingestion API error ${res.status}: ${errorBody}`);
        }

        return (await res.json()) as T;
      } catch (err) {
        // Retry on network errors (abort, connection refused)
        if (attempt < retries && err instanceof Error && (err.name === "AbortError" || err.message.includes("ECONNREFUSED"))) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise<void>(r => { const t = setTimeout(r, delay); if (typeof t === "object" && "unref" in t) t.unref(); });
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(`Ingestion request to ${path} failed after ${retries + 1} attempts`);
  }
}
