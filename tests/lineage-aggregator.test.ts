import { LineageAggregator, extractAppPid } from "../src/discovery/lineageAggregator.js";
import type { RawLineageEdge } from "../src/discovery/types.js";

describe("LineageAggregator", () => {
  let aggregator: LineageAggregator;

  beforeEach(() => {
    aggregator = new LineageAggregator();
  });

  describe("addEdges", () => {
    it("stores unique edges", () => {
      const edges: RawLineageEdge[] = [
        { source_element_pid: "A@T1@S@APP", target_element_pid: "B@T2@S@APP", source_type: "FK" },
        { source_element_pid: "C@T1@S@APP", target_element_pid: "D@T2@S@APP", source_type: "FK" },
      ];
      aggregator.addEdges(edges);
      expect(aggregator.getAllEdges()).toHaveLength(2);
    });

    it("deduplicates same edge from same source type", () => {
      const edge: RawLineageEdge = { source_element_pid: "A@T1@S@APP", target_element_pid: "B@T2@S@APP", source_type: "FK" };
      aggregator.addEdges([edge, edge]);
      expect(aggregator.getAllEdges()).toHaveLength(1);
    });

    it("keeps same edge from different source types", () => {
      const fk: RawLineageEdge = { source_element_pid: "A@T1@S@APP", target_element_pid: "B@T2@S@APP", source_type: "FK" };
      const op: RawLineageEdge = { source_element_pid: "A@T1@S@APP", target_element_pid: "B@T2@S@APP", source_type: "OPERATIONAL" };
      aggregator.addEdges([fk, op]);
      expect(aggregator.getAllEdges()).toHaveLength(2);
    });
  });

  describe("getWinnerEdges", () => {
    it("picks highest weight when same edge has multiple sources", () => {
      const fk: RawLineageEdge = { source_element_pid: "A@T@S@APP", target_element_pid: "B@T@S@APP", source_type: "FK" };
      const manual: RawLineageEdge = { source_element_pid: "A@T@S@APP", target_element_pid: "B@T@S@APP", source_type: "MANUAL" };
      aggregator.addEdges([fk, manual]);

      const winners = aggregator.getWinnerEdges();
      expect(winners).toHaveLength(1);
      expect(winners[0].source_type).toBe("FK"); // FK weight 100 > MANUAL weight 50
    });

    it("respects custom weight overrides", () => {
      const customAgg = new LineageAggregator({ MANUAL: 200 }); // override MANUAL to be highest
      const fk: RawLineageEdge = { source_element_pid: "A@T@S@APP", target_element_pid: "B@T@S@APP", source_type: "FK" };
      const manual: RawLineageEdge = { source_element_pid: "A@T@S@APP", target_element_pid: "B@T@S@APP", source_type: "MANUAL" };
      customAgg.addEdges([fk, manual]);

      const winners = customAgg.getWinnerEdges();
      expect(winners).toHaveLength(1);
      expect(winners[0].source_type).toBe("MANUAL");
    });
  });

  describe("getSummary", () => {
    it("returns correct stats", () => {
      aggregator.addEdges([
        { source_element_pid: "A@T@S@APP", target_element_pid: "B@T@S@APP", source_type: "FK" },
        { source_element_pid: "A@T@S@APP", target_element_pid: "B@T@S@APP", source_type: "FK" }, // duplicate
        { source_element_pid: "C@T@S@APP", target_element_pid: "D@T@S@APP", source_type: "OPERATIONAL" },
      ]);

      const summary = aggregator.getSummary();
      expect(summary.totalRaw).toBe(3);
      expect(summary.uniqueEdges).toBe(2);
      expect(summary.duplicatesRemoved).toBe(1);
      expect(summary.bySourceType.FK).toBe(1);
      expect(summary.bySourceType.OPERATIONAL).toBe(1);
    });

    it("counts cross-app edges", () => {
      aggregator.addEdges([
        {
          source_element_pid: "A@T@S@APP-SRC",
          target_element_pid: "B@T@S@APP-TGT",
          source_type: "OPERATIONAL",
          source_app_pid: "APP-SRC",
          target_app_pid: "APP-TGT",
        },
      ]);

      const summary = aggregator.getSummary();
      expect(summary.crossAppEdges).toBe(1);
    });
  });

  describe("getEdgesByApp", () => {
    it("groups intra-app edges by app PID", () => {
      aggregator.addEdges([
        { source_element_pid: "A@T@S@APP-DISC-PG-01", target_element_pid: "B@T@S@APP-DISC-PG-01", source_type: "FK" },
      ]);
      const byApp = aggregator.getEdgesByApp();
      expect(byApp.has("APP-DISC-PG-01")).toBe(true);
      expect(byApp.get("APP-DISC-PG-01")).toHaveLength(1);
    });

    it("puts cross-app edges under __CROSS_APP__", () => {
      aggregator.addEdges([
        {
          source_element_pid: "A@T@S@APP-SRC",
          target_element_pid: "B@T@S@APP-TGT",
          source_type: "OPERATIONAL",
          source_app_pid: "APP-SRC",
          target_app_pid: "APP-TGT",
        },
      ]);
      const byApp = aggregator.getEdgesByApp();
      expect(byApp.has("__CROSS_APP__")).toBe(true);
    });
  });

  describe("clear", () => {
    it("resets all state", () => {
      aggregator.addEdges([
        { source_element_pid: "A@T@S@APP", target_element_pid: "B@T@S@APP", source_type: "FK" },
      ]);
      expect(aggregator.getAllEdges()).toHaveLength(1);
      aggregator.clear();
      expect(aggregator.getAllEdges()).toHaveLength(0);
      expect(aggregator.getSummary().totalRaw).toBe(0);
    });
  });
});

describe("extractAppPid", () => {
  it("extracts APP-* PID from element PID", () => {
    expect(extractAppPid("COL@TABLE@SCHEMA@APP-DISC-PG-01")).toBe("APP-DISC-PG-01");
  });

  it("returns undefined for PID without APP- prefix", () => {
    expect(extractAppPid("COL@TABLE@SCHEMA@UNKNOWN")).toBeUndefined();
  });

  it("handles multi-part app PIDs", () => {
    expect(extractAppPid("COL@TABLE@SCHEMA@APP-DISC-SNOWFLAKE-ANALYTICS-01")).toBe("APP-DISC-SNOWFLAKE-ANALYTICS-01");
  });
});
