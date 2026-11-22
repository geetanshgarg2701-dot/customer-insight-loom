import { describe, expect, it } from "vitest";
import { pipelineTiles } from "./pipeline-tiles";

const FUNNEL = [
  { stage: "Lead", count: 1000, conversion: 1 },
  { stage: "Qualified", count: 600, conversion: 0.6 },
  { stage: "Proposal", count: 300, conversion: 0.5 },
  { stage: "Won", count: 90, conversion: 0.3 },
];

describe("pipeline tiles, worked out by hand", () => {
  it("counts the deals, the share that won, the hardest step and the stalled share", () => {
    // 1,000 deals entered. 90 reached Won, so 9 percent. The step with the lowest share going on is Proposal to Won, 30
    // percent. 120 open deals are stalled, 12 percent of the deals shown.
    const t = pipelineTiles(FUNNEL, 120);
    expect(t.deals).toBe(1000);
    expect(t.won).toBeCloseTo(0.09, 12);
    expect(t.hardestStep).toEqual({ from: "Proposal", to: "Won", goOn: 0.3 });
    expect(t.stalled).toBe(120);
    expect(t.stalledShare).toBeCloseTo(0.12, 12);
  });

  it("names the hardest step as the first one when two tie", () => {
    const t = pipelineTiles(
      [
        { stage: "Lead", count: 100, conversion: 1 },
        { stage: "Qualified", count: 50, conversion: 0.5 },
        { stage: "Proposal", count: 25, conversion: 0.5 },
        { stage: "Won", count: 20, conversion: 0.8 },
      ],
      0,
    );
    expect(t.hardestStep).toEqual({ from: "Lead", to: "Qualified", goOn: 0.5 });
  });

  it("gives no shares and no hardest step when nothing is selected", () => {
    const t = pipelineTiles(FUNNEL.map((s) => ({ ...s, count: 0, conversion: s.stage === "Lead" ? 1 : 0 })), 0);
    expect(t).toEqual({ deals: 0, won: null, hardestStep: null, stalled: 0, stalledShare: null });
  });

  it("handles no funnel at all", () => {
    expect(pipelineTiles([], 0)).toEqual({ deals: 0, won: null, hardestStep: null, stalled: 0, stalledShare: null });
  });

  it("reads the last stage as Won whatever it is called, and counts stalled deals as they are given", () => {
    const t = pipelineTiles(
      [
        { stage: "A", count: 10, conversion: 1 },
        { stage: "B", count: 4, conversion: 0.4 },
      ],
      3,
    );
    expect(t.won).toBeCloseTo(0.4, 12);
    expect(t.hardestStep).toEqual({ from: "A", to: "B", goOn: 0.4 });
    expect(t.stalledShare).toBeCloseTo(0.3, 12);
  });
});

import { afterAll, beforeAll } from "vitest";
import { PIPELINE_AS_OF, syntheticPipeline } from "../demo/pipeline";
import { createNodeEngine } from "../intake/testing/node-engine";
import type { SqlEngine } from "../intake/types";
import { loadPipeline, stageFunnel, stalledByStage } from "./pipeline";

describe("pipeline tiles against the generated deals", () => {
  const rows = syntheticPipeline(20_000, 7);
  let engine: SqlEngine;
  beforeAll(async () => {
    engine = await createNodeEngine({ isolated: true });
    await loadPipeline(engine, "pipeline", rows);
  }, 120_000);
  afterAll(async () => {
    await engine.close?.();
  });

  it("matches counts made straight from the rows, with and without a filter", async () => {
    for (const selection of [{}, { segment: ["smb"] }, { source: ["referral"], segment: ["enterprise"] }] as const) {
      const keep = rows.filter(
        (r) => (!("segment" in selection) || (selection.segment as readonly string[]).includes(r.segment)) && (!("source" in selection) || (selection.source as readonly string[]).includes(r.source)),
      );
      const stalled = (await stalledByStage(engine, "pipeline", { thresholdDays: 30, asOf: PIPELINE_AS_OF }, selection as never)).reduce((n, s) => n + s.count, 0);
      const t = pipelineTiles(await stageFunnel(engine, "pipeline", selection as never), stalled);
      expect(t.deals).toBe(keep.length);
      expect(t.won).toBeCloseTo(keep.filter((r) => r.status === "won").length / keep.length, 12);
      expect(t.stalled).toBe(stalled);
    }
  }, 120_000);
});
