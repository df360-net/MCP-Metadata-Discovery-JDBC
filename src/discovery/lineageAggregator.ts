/**
 * DF360 Hybrid Lineage Aggregator
 *
 * Central merge hub that collects lineage edges from multiple providers
 * (FK, Operational, ETL, SQL Parser, Manual), deduplicates them, and
 * produces a unified set of edges ready for ingestion into the staging
 * table (data_elem_lin_source).
 *
 * The aggregator does NOT write to the database — it produces payloads
 * that the ingest API consumes.
 *
 * Weight-based winner selection happens at the database level (staging →
 * production promotion), not here. The aggregator's job is to collect,
 * tag, and deduplicate raw edges from all sources.
 */

import type { RawLineageEdge, LineageSourceKind, LineageAggregatorSummary } from './types.js';

// Default source type weights — can be overridden via config.lineage.sourceWeights
const DEFAULT_SOURCE_WEIGHTS: Record<LineageSourceKind, number> = {
  FK: 100,
  OPERATIONAL: 80,
  ETL: 60,
  MANUAL: 50,
  SQL_PARSER: 40,
};

/**
 * Build a dedup key for an edge: "sourceElemPid|targetElemPid"
 * Two edges are the "same" if they connect the same pair of elements,
 * regardless of which provider discovered them.
 */
function edgeKey(edge: RawLineageEdge): string {
  return `${edge.source_element_pid}|${edge.target_element_pid}`;
}

export class LineageAggregator {
  private readonly sourceWeights: Record<LineageSourceKind, number>;

  /** All raw edges received, keyed by edge+sourceType to prevent exact dupes */
  private readonly rawEdges = new Map<string, RawLineageEdge>();

  /** Count of raw addEdges() calls (before dedup) */
  private rawCount = 0;

  constructor(weightOverrides?: Partial<Record<LineageSourceKind, number>>) {
    this.sourceWeights = { ...DEFAULT_SOURCE_WEIGHTS, ...weightOverrides };
  }

  /**
   * Add edges from a lineage provider.
   * Duplicate edges from the SAME source type are silently ignored.
   * The same edge from DIFFERENT source types is kept (both go to staging).
   */
  addEdges(edges: RawLineageEdge[]): void {
    for (const edge of edges) {
      this.rawCount++;
      // Key includes source_type so FK and OPERATIONAL for same edge are separate
      const key = `${edgeKey(edge)}|${edge.source_type}`;
      if (!this.rawEdges.has(key)) {
        this.rawEdges.set(key, edge);
      }
    }
  }

  /**
   * Get all unique edges (one per source+target+sourceType combo).
   * This is what gets written to the staging table.
   */
  getAllEdges(): RawLineageEdge[] {
    return Array.from(this.rawEdges.values());
  }

  /**
   * Get deduplicated winner edges — one edge per (source, target) pair,
   * keeping only the highest-weight source type.
   *
   * Tie-breaking when weights are equal (possible with user-overridden
   * sourceWeights): alphabetical order of source_type, ascending. This
   * guarantees deterministic output regardless of input order.
   *
   * This is a preview of what the DB winner selection would produce.
   */
  getWinnerEdges(): RawLineageEdge[] {
    const winners = new Map<string, RawLineageEdge>();

    for (const edge of Array.from(this.rawEdges.values())) {
      const key = edgeKey(edge);
      const existing = winners.get(key);
      if (!existing) {
        winners.set(key, edge);
        continue;
      }
      const newWeight = this.sourceWeights[edge.source_type];
      const existingWeight = this.sourceWeights[existing.source_type];
      if (newWeight > existingWeight) {
        winners.set(key, edge);
      } else if (newWeight === existingWeight && edge.source_type < existing.source_type) {
        // Weights tied — break tie by alphabetical source_type for determinism
        winners.set(key, edge);
      }
    }

    return Array.from(winners.values());
  }

  /**
   * Group edges by application PID for per-app ingestion.
   * Intra-app edges go under their app. Cross-app edges are collected
   * under a special "__CROSS_APP__" key.
   */
  getEdgesByApp(): Map<string, RawLineageEdge[]> {
    const byApp = new Map<string, RawLineageEdge[]>();

    for (const edge of Array.from(this.rawEdges.values())) {
      const srcApp = edge.source_app_pid ?? extractAppPid(edge.source_element_pid);
      const tgtApp = edge.target_app_pid ?? extractAppPid(edge.target_element_pid);

      if (srcApp && tgtApp && srcApp !== tgtApp) {
        // Cross-app edge — needs special handling
        const list = byApp.get('__CROSS_APP__') ?? [];
        list.push(edge);
        byApp.set('__CROSS_APP__', list);
      } else {
        // Intra-app — file under the app PID
        const appPid = srcApp ?? tgtApp ?? '__UNKNOWN__';
        const list = byApp.get(appPid) ?? [];
        list.push(edge);
        byApp.set(appPid, list);
      }
    }

    return byApp;
  }

  /**
   * Get summary statistics for logging and reporting.
   */
  getSummary(): LineageAggregatorSummary {
    const bySourceType: Record<LineageSourceKind, number> = {
      FK: 0, OPERATIONAL: 0, ETL: 0, SQL_PARSER: 0, MANUAL: 0,
    };

    let crossAppEdges = 0;

    for (const edge of Array.from(this.rawEdges.values())) {
      bySourceType[edge.source_type]++;

      const srcApp = edge.source_app_pid ?? extractAppPid(edge.source_element_pid);
      const tgtApp = edge.target_app_pid ?? extractAppPid(edge.target_element_pid);
      if (srcApp && tgtApp && srcApp !== tgtApp) {
        crossAppEdges++;
      }
    }

    const uniqueEdges = new Set(
      Array.from(this.rawEdges.values()).map(edgeKey),
    ).size;

    return {
      totalRaw: this.rawCount,
      uniqueEdges,
      duplicatesRemoved: this.rawCount - this.rawEdges.size,
      bySourceType,
      crossAppEdges,
    };
  }

  /** Reset the aggregator for a new run */
  clear(): void {
    this.rawEdges.clear();
    this.rawCount = 0;
  }
}

/**
 * Extract the application PID from an element PID.
 *
 * Element PID format: COLUMN@TABLE@SCHEMA@APP-PID
 * We need the rightmost segment that starts with "APP-"
 *
 * Example: "ORDER_ID@ORDERS@ANALYTICS@APP-DISC-SNOWFLAKE-ANALYTICS-01"
 *   → "APP-DISC-SNOWFLAKE-ANALYTICS-01"
 */
export function extractAppPid(elementPid: string): string | undefined {
  // PIDs use @ as separator. The app PID is the tail after the last schema segment.
  // Element: COL@ENTITY@CONTAINER@APP
  // Entity:  TABLE@CONTAINER@APP
  // Container: SCHEMA@APP
  // The app PID itself may contain hyphens but not @.
  const parts = elementPid.split('@');
  // Walk from the end to find the single "APP-..." segment.
  // The app PID is a single @-delimited segment; never join trailing parts.
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].startsWith('APP-')) {
      return parts[i];
    }
  }
  return undefined;
}
