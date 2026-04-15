/**
 * Mock Ingestion API — mimics DCF's Metadata Ingestion REST API.
 *
 * Instead of writing to a database, saves payloads as JSON files under
 * data/metadata-ingestion/. Returns the same IngestionResponse format
 * that the real DCF API returns.
 *
 * Endpoints:
 *   POST /api/v1/ingest/container-with-entities
 *   POST /api/v1/ingest/entity-with-elements
 *   POST /api/v1/ingest/lineage
 */

import { Router } from "express";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ContainerWithEntitiesPayload,
  EntityWithElementsPayload,
  LineagePayload,
  IngestionResponse,
  IngestionResultItem,
  IngestionSummary,
} from "./types.js";

export function createIngestRouter(dataDir: string): Router {
  const router = Router();
  const ingestDir = resolve(dataDir, "metadata-ingestion");

  // Ensure directory exists
  if (!existsSync(ingestDir)) {
    mkdirSync(ingestDir, { recursive: true });
  }

  // ── Helper: load or create store file ──
  function loadStore(filename: string): Record<string, unknown> {
    const filePath = resolve(ingestDir, filename);
    if (!existsSync(filePath)) return {};
    try {
      return JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      return {};
    }
  }

  function saveStore(filename: string, data: unknown): void {
    writeFileSync(resolve(ingestDir, filename), JSON.stringify(data, null, 2), "utf-8");
  }

  // ── 1. Container with Entities ──
  router.post("/container-with-entities", (req, res) => {
    try {
      const payload = req.body as ContainerWithEntitiesPayload;

      if (!payload.application_pid || !payload.container || !payload.entities) {
        res.status(400).json({ error: "application_pid, container, and entities are required" });
        return;
      }

      const results: IngestionResultItem[] = [];
      const storeFile = `${sanitize(payload.application_pid)}.json`;
      const store = loadStore(storeFile) as Record<string, any>;

      // Upsert container
      const containerPid = payload.container.data_container_pid;
      if (!containerPid || typeof containerPid !== "string" || !containerPid.trim()) {
        res.status(400).json({ error: "container.data_container_pid must be a non-empty string" });
        return;
      }
      const existed = !!store[containerPid];
      store[containerPid] = {
        type: "container",
        ...payload.container,
        application_pid: payload.application_pid,
        updated_at: new Date().toISOString(),
      };
      results.push({
        pid: containerPid,
        action: existed ? "updated" : "created",
        id: containerPid,
      });

      // Upsert entities and elements
      for (const ent of payload.entities) {
        const entityPid = ent.entity.data_entity_pid;
        const entityExisted = !!store[entityPid];
        store[entityPid] = {
          type: "entity",
          ...ent.entity,
          container_pid: containerPid,
          updated_at: new Date().toISOString(),
        };
        results.push({
          pid: entityPid,
          action: entityExisted ? "updated" : "created",
          id: entityPid,
        });

        for (const elem of ent.elements) {
          const elemPid = elem.data_element_pid;
          const elemExisted = !!store[elemPid];
          store[elemPid] = {
            type: "element",
            ...elem,
            entity_pid: entityPid,
            updated_at: new Date().toISOString(),
          };
          results.push({
            pid: elemPid,
            action: elemExisted ? "updated" : "created",
            id: elemPid,
          });
        }
      }

      saveStore(storeFile, store);

      const summary = buildSummary(results);
      const response: IngestionResponse = { status: summary.failed > 0 ? "partial" : "completed", summary, results };
      res.json(response);
    } catch (err: unknown) {
      res.status(500).json({
        status: "failed",
        summary: { total: 0, created: 0, updated: 0, unchanged: 0, failed: 1 },
        results: [{ pid: "unknown", action: "failed", error: err instanceof Error ? err.message : String(err) }],
      });
    }
  });

  // ── 2. Entity with Elements ──
  router.post("/entity-with-elements", (req, res) => {
    try {
      const payload = req.body as EntityWithElementsPayload;

      if (!payload.container_pid || !payload.entity || !payload.elements) {
        res.status(400).json({ error: "container_pid, entity, and elements are required" });
        return;
      }

      const results: IngestionResultItem[] = [];

      // Find which store file this container belongs to (search all files)
      const storeFile = findStoreByContainerPid(ingestDir, payload.container_pid);
      if (!storeFile) {
        res.status(400).json({ error: `Container not found: ${payload.container_pid}` });
        return;
      }

      const store = loadStore(storeFile) as Record<string, any>;

      // Upsert entity
      const entityPid = payload.entity.data_entity_pid;
      const entityExisted = !!store[entityPid];
      store[entityPid] = {
        type: "entity",
        ...payload.entity,
        container_pid: payload.container_pid,
        updated_at: new Date().toISOString(),
      };
      results.push({
        pid: entityPid,
        action: entityExisted ? "updated" : "created",
        id: entityPid,
      });

      // Upsert elements
      for (const elem of payload.elements) {
        const elemPid = elem.data_element_pid;
        const elemExisted = !!store[elemPid];
        store[elemPid] = {
          type: "element",
          ...elem,
          entity_pid: entityPid,
          updated_at: new Date().toISOString(),
        };
        results.push({
          pid: elemPid,
          action: elemExisted ? "updated" : "created",
          id: elemPid,
        });
      }

      saveStore(storeFile, store);

      const summary = buildSummary(results);
      const response: IngestionResponse = { status: summary.failed > 0 ? "partial" : "completed", summary, results };
      res.json(response);
    } catch (err: unknown) {
      res.status(500).json({
        status: "failed",
        summary: { total: 0, created: 0, updated: 0, unchanged: 0, failed: 1 },
        results: [{ pid: "unknown", action: "failed", error: err instanceof Error ? err.message : String(err) }],
      });
    }
  });

  // ── 3. Lineage ──
  router.post("/lineage", (req, res) => {
    try {
      const payload = req.body as LineagePayload;

      if (!payload.application_pid || !payload.edges || payload.edges.length === 0) {
        res.status(400).json({ error: "application_pid and edges are required" });
        return;
      }

      const validSourceTypes = new Set(["FK", "OPERATIONAL", "ETL", "SQL_PARSER", "MANUAL"]);
      if (payload.lineage_source && !validSourceTypes.has(payload.lineage_source)) {
        res.status(400).json({ error: `Invalid lineage_source: ${payload.lineage_source}. Must be one of: ${[...validSourceTypes].join(", ")}` });
        return;
      }

      const lineageFile = `lineage-${sanitize(payload.application_pid)}.json`;
      const store = loadStore(lineageFile) as Record<string, any>;

      const results: IngestionResultItem[] = [];

      for (const edge of payload.edges) {
        // Skip self-referencing edges
        if (edge.source_element_pid === edge.target_element_pid) {
          results.push({ pid: `${edge.source_element_pid}→self`, action: "failed", error: "Self-referencing edge" });
          continue;
        }

        const edgeKey = `${edge.source_element_pid}|${edge.target_element_pid}`;
        const existed = !!store[edgeKey];
        store[edgeKey] = {
          ...edge,
          lineage_source: payload.lineage_source ?? "FK",
          application_pid: payload.application_pid,
          updated_at: new Date().toISOString(),
        };
        results.push({
          pid: edgeKey,
          action: existed ? "updated" : "created",
          id: edgeKey,
        });
      }

      saveStore(lineageFile, store);

      const summary = buildSummary(results);
      const response: IngestionResponse = { status: summary.failed > 0 ? "partial" : "completed", summary, results };
      res.json(response);
    } catch (err: unknown) {
      res.status(500).json({
        status: "failed",
        summary: { total: 0, created: 0, updated: 0, unchanged: 0, failed: 1 },
        results: [{ pid: "unknown", action: "failed", error: err instanceof Error ? err.message : String(err) }],
      });
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSummary(results: IngestionResultItem[]): IngestionSummary {
  return {
    total: results.length,
    created: results.filter((r) => r.action === "created").length,
    updated: results.filter((r) => r.action === "updated").length,
    unchanged: results.filter((r) => r.action === "unchanged").length,
    failed: results.filter((r) => r.action === "failed").length,
  };
}

function sanitize(pid: string): string {
  return pid.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function findStoreByContainerPid(ingestDir: string, containerPid: string): string | null {
  // Search all JSON files for the container PID
  try {
    const files = readdirSync(ingestDir) as string[];
    for (const file of files) {
      if (!file.endsWith(".json") || file.startsWith("lineage-")) continue;
      const filePath = resolve(ingestDir, file);
      try {
        const data = JSON.parse(readFileSync(filePath, "utf-8"));
        if (data[containerPid]) return file;
      } catch {
        continue;
      }
    }
  } catch {
    // directory might not exist yet
  }
  return null;
}
