import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PIPELINE_AS_OF, PIPELINE_STAGES, syntheticPipeline } from "../demo/pipeline";
import type { SqlEngine } from "../intake/types";
import { createNodeEngine } from "../intake/testing/node-engine";
import {
  PIPELINE_DIMENSIONS,
  dwellHistogram,
  loadPipeline,
  pipelineCounts,
  pipelineWhere,
  stageFunnel,
  stalledByStage,
  type PipelineSelection,
} from "./pipeline";

const TABLE = "pipeline";
const ROWS = 100_000;
let engine: SqlEngine;

beforeAll(async () => {
  engine = await createNodeEngine();
  await loadPipeline(engine, TABLE, syntheticPipeline(ROWS, 21));
}, 120_000);

afterAll(async () => {
  await engine.close?.();
});

describe("pipelineWhere", () => {
  it("binds values and leaves out the chart's own dimension", () => {
    const w = pipelineWhere({ segment: ["smb", "mid"], source: ["inbound"] }, "segment");
    expect(w.sql).toBe('WHERE "source" IN (?)');
    expect(w.params).toEqual(["inbound"]);
  });

  it("refuses a column that is not on the list", () => {
    expect(() => pipelineWhere({ "segment; DROP TABLE pipeline": ["x"] } as unknown as PipelineSelection)).toThrow(RangeError);
  });

  it("knows its own dimensions", () => {
    expect([...PIPELINE_DIMENSIONS]).toEqual(["segment", "source", "stage"]);
  });
});

describe("pipelineCounts", () => {
  it("counts every row once, and a hostile value matches nothing", async () => {
    const all = await pipelineCounts(engine, TABLE, "segment", {});
    expect(all.reduce((n, c) => n + c.count, 0)).toBe(ROWS);
    expect(await pipelineCounts(engine, TABLE, "segment", { source: ["x' OR '1'='1"] })).toEqual([]);
    await expect(pipelineCounts(engine, TABLE, "email", {})).rejects.toThrow(RangeError);
  });
});

describe("stageFunnel", () => {
  it("never grows from one stage to the next, and starts with everyone", async () => {
    const funnel = await stageFunnel(engine, TABLE, {});
    expect(funnel.map((f) => f.stage)).toEqual([...PIPELINE_STAGES]);
    expect(funnel[0].count).toBe(ROWS);
    for (let i = 1; i < funnel.length; i++) expect(funnel[i].count).toBeLessThanOrEqual(funnel[i - 1].count);
    expect(funnel[0].conversion).toBe(1);
    expect(funnel[2].conversion).toBeCloseTo(funnel[2].count / funnel[1].count, 10);
  });

  it("shows the planted fact: enterprise wins less often than small deals", async () => {
    const won = async (segment: string) => {
      const f = await stageFunnel(engine, TABLE, { segment: [segment] });
      return f[3].count / f[0].count;
    };
    expect(await won("enterprise")).toBeLessThan((await won("smb")) * 0.8);
  });
});

describe("dwellHistogram", () => {
  it("has every moved customer in exactly one bin, and a median and 90th percentile that make sense", async () => {
    const h = await dwellHistogram(engine, TABLE, 2, {});
    const funnel = await stageFunnel(engine, TABLE, {});
    expect(h.moved).toBe(funnel[3].count);
    expect(h.bins.reduce((n, b) => n + b.count, 0)).toBe(h.moved);
    expect(h.medianDays).toBeGreaterThan(0);
    expect(h.p90Days).toBeGreaterThanOrEqual(h.medianDays);
  });

  it("is longer in Proposal for enterprise than for small deals", async () => {
    const ent = await dwellHistogram(engine, TABLE, 2, { segment: ["enterprise"] });
    const smb = await dwellHistogram(engine, TABLE, 2, { segment: ["smb"] });
    expect(ent.medianDays).toBeGreaterThan(smb.medianDays * 2);
  });

  it("rejects a stage that has no next stage", async () => {
    await expect(dwellHistogram(engine, TABLE, 3, {})).rejects.toThrow(RangeError);
    await expect(dwellHistogram(engine, TABLE, -1, {})).rejects.toThrow(RangeError);
  });
});

describe("stalledByStage", () => {
  it("counts only open customers, never a won one", async () => {
    const s = await stalledByStage(engine, TABLE, { thresholdDays: 30, asOf: PIPELINE_AS_OF }, {});
    expect(s.map((x) => x.stage)).not.toContain("Won");
    expect(s.every((x) => x.count > 0 && x.medianIdleDays >= 30)).toBe(true);
  });

  it("finds more stalled customers at a shorter threshold than a longer one", async () => {
    const total = async (days: number) =>
      (await stalledByStage(engine, TABLE, { thresholdDays: days, asOf: PIPELINE_AS_OF }, {})).reduce((n, x) => n + x.count, 0);
    expect(await total(14)).toBeGreaterThan(await total(60));
  });

  it("agrees with the funnel: stalled plus moved on plus won equals everyone who reached the stage", async () => {
    // At the strictest threshold of 0 days, every open customer is stalled at their current stage.
    const s = await stalledByStage(engine, TABLE, { thresholdDays: 0, asOf: PIPELINE_AS_OF }, {});
    const open = (await pipelineCounts(engine, TABLE, "stage", {})).filter((c) => c.value !== "Won").reduce((n, c) => n + c.count, 0);
    expect(s.reduce((n, x) => n + x.count, 0)).toBe(open);
  });

  it("refuses a bad threshold or time", async () => {
    await expect(stalledByStage(engine, TABLE, { thresholdDays: -1, asOf: PIPELINE_AS_OF }, {})).rejects.toThrow(RangeError);
    await expect(stalledByStage(engine, TABLE, { thresholdDays: 30, asOf: "yesterday" }, {})).rejects.toThrow(RangeError);
  });
});

describe("speed on 100,000 customers", () => {
  it("updates the funnel, the time in stage and the stalled view after a selection in under 1 second", async () => {
    const selection: PipelineSelection = { segment: ["enterprise"], source: ["inbound"] };
    const started = performance.now();
    await Promise.all([
      stageFunnel(engine, TABLE, selection),
      dwellHistogram(engine, TABLE, 2, selection),
      stalledByStage(engine, TABLE, { thresholdDays: 30, asOf: PIPELINE_AS_OF }, selection),
      ...PIPELINE_DIMENSIONS.map((d) => pipelineCounts(engine, TABLE, d, selection)),
    ]);
    const ms = performance.now() - started;
    console.log(`pipeline update on ${ROWS} rows in Node: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1000);
  });
});
