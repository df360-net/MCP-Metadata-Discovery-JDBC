import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DiscoveryManager } from "./discovery-manager.js";

export function registerTools(server: McpServer, manager: DiscoveryManager): void {

  // Tool 1: list_connectors
  server.tool(
    "list_connectors",
    "List all configured database connectors and their discovery status.",
    {},
    async () => {
      const connectors = manager.listConnectors();
      return {
        content: [{ type: "text", text: JSON.stringify(connectors, null, 2) }],
      };
    },
  );

  // Tool 2: test_connection
  server.tool(
    "test_connection",
    "Test connectivity to a database connector. Returns success, server version, and latency.",
    {
      connector: z.string().min(1).describe("Connector ID to test"),
    },
    async ({ connector }) => {
      try {
        const result = await manager.testConnection(connector);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // Tool 3: discover_metadata
  server.tool(
    "discover_metadata",
    "Run metadata discovery on a database connector. Crawls schemas, tables, columns, keys, and indexes.",
    {
      connector: z.string().min(1).describe("Connector ID to discover"),
    },
    async ({ connector }) => {
      try {
        const summary = await manager.discoverMetadata(connector);
        return {
          content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // Tool 4: get_schema
  server.tool(
    "get_schema",
    "Get discovered schema metadata for a connector. Optionally filter by schema or table name.",
    {
      connector: z.string().min(1).describe("Connector ID"),
      schema: z.string().optional().describe("Filter by schema name"),
      table: z.string().optional().describe("Filter by table name"),
    },
    async ({ connector, schema, table }) => {
      const db = manager.getDiscoveredSchema(connector);
      if (!db) {
        return {
          content: [{ type: "text", text: `No cached discovery for connector '${connector}'. Run discover_metadata first.` }],
          isError: true,
        };
      }

      let result: unknown = db;

      if (schema) {
        const filtered = db.schemas.filter(
          (s) => s.schemaName.toLowerCase() === schema.toLowerCase(),
        );
        if (filtered.length === 0) {
          return {
            content: [{ type: "text", text: `Schema '${schema}' not found in connector '${connector}'.` }],
            isError: true,
          };
        }
        result = filtered;

        if (table) {
          const allTables = filtered.flatMap((s) => [...s.tables, ...s.views]);
          const matched = allTables.filter(
            (t) => t.tableName.toLowerCase() === table.toLowerCase(),
          );
          if (matched.length === 0) {
            return {
              content: [{ type: "text", text: `Table '${table}' not found in schema '${schema}'.` }],
              isError: true,
            };
          }
          result = matched;
        }
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // Tool 5: get_lineage
  server.tool(
    "get_lineage",
    "Get data lineage edges (FK-based). Optionally filter by connector or table.",
    {
      connector: z.string().optional().describe("Filter by connector ID"),
      table: z.string().optional().describe("Filter by table name"),
    },
    async ({ connector, table }) => {
      const edges = manager.getLineage(connector, table);
      const summary = manager.getLineageSummary();
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ summary, edgeCount: edges.length, edges }, null, 2),
        }],
      };
    },
  );

  // Tool 6: search_columns
  server.tool(
    "search_columns",
    "Search for columns by name pattern across all discovered databases.",
    {
      pattern: z.string().min(1).max(500).describe("Regex pattern to match column names (e.g., 'email', 'user_id', '.*_at$'). Max 500 chars."),
      connector: z.string().optional().describe("Limit search to a specific connector"),
    },
    async ({ pattern, connector }) => {
      try {
        const results = manager.searchColumns(pattern, connector);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ matchCount: results.length, results }, null, 2),
          }],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text", text: `Invalid pattern: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );
}
