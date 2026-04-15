#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { registerTools } from "./tools.js";
import { loadConfig } from "./config.js";
import { ConfigStore } from "./config-store.js";
import { DiscoveryManager } from "./discovery-manager.js";
import { createApiRouter } from "./api-routes.js";
import { createIngestRouter } from "./ingestion/mock-ingest-routes.js";
import { SchedulerStore } from "./scheduler/store.js";
import { SchedulerEngine } from "./scheduler/engine.js";
import { createSchedulerRouter } from "./scheduler/scheduler-routes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Shared: create MCP server + register tools
function createServer(manager: DiscoveryManager): McpServer {
  const pkg = JSON.parse(
    readFileSync(resolve(__dirname, "..", "package.json"), "utf-8"),
  ) as { version: string };
  const server = new McpServer({
    name: "mcp-metadata-discovery",
    version: pkg.version,
  });
  registerTools(server, manager);
  return server;
}

// --- stdio transport ---
async function startStdio(manager: DiscoveryManager) {
  const server = createServer(manager);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-metadata-discovery running on stdio");
}

// --- HTTP transport (stateful — session per client) ---
async function startHttp(manager: DiscoveryManager, configStore: ConfigStore, port: number, config: ReturnType<typeof loadConfig>) {
  const app = express();

  // ── E4: CORS ──
  // Restrict CORS to known local origins. The Admin UI is served from
  // the same port (8090); the webpack dev server runs on 5174 and proxies
  // /api through to 8090. If you deploy behind a reverse proxy or need
  // cross-origin access, set CORS_ORIGINS (comma-separated) to override.
  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
    : ["http://localhost:8090", "http://localhost:5174", "http://127.0.0.1:8090", "http://127.0.0.1:5174"];
  app.use(cors({ origin: corsOrigins, credentials: false }));

  // ── Security headers ──
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    next();
  });

  // ── E5: Request logging ──
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      console.log(`[http] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
    });
    next();
  });

  app.use(express.json({ limit: config.server?.jsonBodySizeLimit ?? "1mb" }));

  // ── E3: Rate limiting ──
  const discoveryLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: "Too many discovery requests, try again later" } });
  const apiLimiter = rateLimit({ windowMs: 60_000, max: 100, standardHeaders: true, legacyHeaders: false, message: { error: "Too many API requests, try again later" } });

  // ── Mock ingestion API (mimics DCF) ──
  app.use("/api/v1/ingest", createIngestRouter(config.dataDir));

  // ── REST API for admin UI ──
  app.use("/api", createApiRouter(manager, configStore, config.ingestion, port));

  // ── Scheduler ──
  const defaultIngestUrl = `http://localhost:${port}/api/v1/ingest`;
  const schedulerStore = new SchedulerStore(config.dataDir);
  const schedulerEngine = new SchedulerEngine({
    store: schedulerStore,
    discoveryManager: manager,
    ingestionConfig: config.ingestion,
    defaultIngestUrl,
    tickIntervalMs: config.scheduler?.tickIntervalMs,
  });
  if (config.scheduler?.enabled !== false) {
    schedulerEngine.start();
  }
  app.use("/api/scheduler", createSchedulerRouter(schedulerStore, schedulerEngine));

  // Apply rate limiters to specific routes
  app.use("/api/connectors/:id/discover", discoveryLimiter);
  app.use("/api/connectors/:id/test", discoveryLimiter);
  app.use("/api/search", apiLimiter);
  app.use("/api/lineage", apiLimiter);

  // ── MCP protocol (stateful sessions) ──
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  app.post("/mcp", async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (!sessionId) {
        if (!isInitializeRequest(req.body)) {
          res.status(400).json({
            jsonrpc: "2.0",
            error: { code: -32600, message: "First request must be an initialize request" },
            id: null,
          });
          return;
        }

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });

        const server = createServer(manager);
        await server.connect(transport);

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) sessions.delete(sid);
        };

        await transport.handleRequest(req, res, req.body);

        if (transport.sessionId) {
          sessions.set(transport.sessionId, transport);
        }
        return;
      }

      const transport = sessions.get(sessionId);
      if (!transport) {
        res.status(404).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Session not found. Send an initialize request first." },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[mcp] POST /mcp error:", err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });

  app.get("/mcp", async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId) { res.status(400).json({ error: "Missing Mcp-Session-Id header" }); return; }
      const transport = sessions.get(sessionId);
      if (!transport) { res.status(404).json({ error: "Session not found" }); return; }
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error("[mcp] GET /mcp error:", err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });

  app.delete("/mcp", async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId) { res.status(400).json({ error: "Missing Mcp-Session-Id header" }); return; }
      const transport = sessions.get(sessionId);
      if (!transport) { res.status(404).json({ error: "Session not found" }); return; }
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error("[mcp] DELETE /mcp error:", err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    } finally {
      const sid = req.headers["mcp-session-id"] as string | undefined;
      if (sid) sessions.delete(sid);
    }
  });

  // ── Health check (E9: richer) ──
  const cachedVersion = JSON.parse(readFileSync(resolve(__dirname, "..", "package.json"), "utf-8")).version as string;

  app.get("/health", (_req, res) => {
    const mem = process.memoryUsage();
    const connectorList = manager.listConnectors();
    res.json({
      ok: true,
      server: "mcp-metadata-discovery",
      version: cachedVersion,
      nodeVersion: process.version,
      uptime: Math.floor(process.uptime()),
      connectors: connectorList.length,
      connectorsWithCache: connectorList.filter((c) => c.hasCachedDiscovery).length,
      activeSessions: sessions.size,
      memory: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      },
    });
  });

  // ── Serve built UI (production) ──
  const uiDist = resolve(__dirname, "..", "dist", "ui");
  if (existsSync(uiDist)) {
    app.use(express.static(uiDist));
    app.get("/{*path}", (_req, res) => {
      res.sendFile(resolve(uiDist, "index.html"));
    });
  }

  const httpServer = app.listen(port, () => {
    console.log(`mcp-metadata-discovery HTTP server listening on port ${port}`);
    console.log(`MCP endpoint: http://localhost:${port}/mcp`);
    console.log(`Admin API:    http://localhost:${port}/api`);
    console.log(`Health check: http://localhost:${port}/health`);
    if (existsSync(uiDist)) {
      console.log(`Admin UI:     http://localhost:${port}/`);
    }
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      console.error(`Received ${signal}, shutting down...`);
      schedulerEngine.stop();
      // Clear all active MCP sessions
      for (const [sid, transport] of sessions) {
        try { transport.close?.(); } catch { /* ignore */ }
        sessions.delete(sid);
      }
      httpServer.close(async () => {
        await manager.close();
        console.error("Shutdown complete.");
        process.exit(0);
      });
      const shutdownMs = config.server?.shutdownTimeoutMs ?? 10000;
      setTimeout(() => { console.error("Forced shutdown after timeout."); process.exit(1); }, shutdownMs).unref();
    });
  }
}

// --- Main ---
async function main() {
  const args = process.argv.slice(2);

  const configIndex = args.indexOf("--config");
  let configPath: string | undefined;
  if (configIndex !== -1) {
    if (configIndex + 1 >= args.length) {
      console.error("--config requires a file path argument.");
      process.exit(1);
    }
    configPath = args[configIndex + 1];
  }

  const config = loadConfig(configPath);
  const configStore = new ConfigStore(configPath);
  const manager = new DiscoveryManager(config);

  console.error(`Loaded ${manager.listConnectors().length} connector(s)`);

  if (args.includes("--stdio")) {
    await startStdio(manager);
  } else {
    const portIndex = args.indexOf("--port");
    let port = config.server?.port ?? 8090;
    if (portIndex !== -1) {
      const parsed = parseInt(args[portIndex + 1], 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
        console.error(`Invalid port: ${args[portIndex + 1]}. Using default ${port}.`);
      } else {
        port = parsed;
      }
    }
    await startHttp(manager, configStore, port, config);
  }
}

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  process.exit(1);
});

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
