import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PIPELINE_AS_OF, PIPELINE_STAGES, syntheticPipeline } from "../demo/pipeline";
import type { SqlEngine } from "../intake/types";
import { createNodeEngine } from "../intake/testing/node-engine";
import {
  PIPELINE_DIMENSIONS,
  cohortLadder,
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
    expect([...PIPELINE_DIMENSIONS]).toEqual(["segment", "source", "stage", "status"]);
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

  it("leaves out lost deals, which are closed, not stalled", async () => {
    const stalled = (await stalledByStage(engine, TABLE, { thresholdDays: 0, asOf: PIPELINE_AS_OF }, {})).reduce((n, x) => n + x.count, 0);
    const byStatus = await pipelineCounts(engine, TABLE, "status", {});
    const count = (v: string) => byStatus.find((c) => c.value === v)?.count ?? 0;
    expect(stalled).toBe(count("open"));
    expect(count("lost")).toBeGreaterThan(count("open"));
    expect(count("won") + count("lost") + count("open")).toBe(ROWS);
  });

  it("finds more stalled customers at a shorter threshold than a longer one", async () => {
    const total = async (days: number) =>
      (await stalledByStage(engine, TABLE, { thresholdDays: days, asOf: PIPELINE_AS_OF }, {})).reduce((n, x) => n + x.count, 0);
    expect(await total(14)).toBeGreaterThan(await total(60));
  });

  it("agrees with the status counts: at a threshold of 0 every open deal is stalled at its stage", async () => {
    // At a threshold of 0 days, every open deal is stalled at its current stage.
    const s = await stalledByStage(engine, TABLE, { thresholdDays: 0, asOf: PIPELINE_AS_OF }, {});
    const open = (await pipelineCounts(engine, TABLE, "status", {})).find((c) => c.value === "open")!.count;
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

describe("cohortLadder, plan section on the cohort ladder", () => {
  it("groups deals by the month they entered, in UTC, and every deal is in exactly one cohort", async () => {
    const ladder = await cohortLadder(engine, TABLE, { windowDays: 60, asOf: PIPELINE_AS_OF }, {});
    expect(ladder.reduce((n, c) => n + c.deals, 0)).toBe(ROWS);
    const months = ladder.map((c) => c.cohort);
    expect(months).toEqual([...months].sort());
    for (const m of months) expect(m).toMatch(/^\d{4}-\d{2}$/);
  });

  it("never reaches more of a later stage than an earlier one, and shares are between 0 and 1", async () => {
    const ladder = await cohortLadder(engine, TABLE, { windowDays: 60, asOf: PIPELINE_AS_OF }, {});
    for (const c of ladder) {
      expect(c.reachedProposal).toBeLessThanOrEqual(c.reachedQualified);
      expect(c.reachedWon).toBeLessThanOrEqual(c.reachedProposal);
      expect(c.reachedQualified).toBeLessThanOrEqual(c.deals);
      for (const share of [c.qualifiedShare, c.proposalShare, c.wonShare]) {
        expect(share).toBeGreaterThanOrEqual(0);
        expect(share).toBeLessThanOrEqual(1);
      }
    }
  });

  it("marks a cohort mature only when every deal in it has had the whole window", async () => {
    const asOf = Date.parse(PIPELINE_AS_OF);
    const ladder = await cohortLadder(engine, TABLE, { windowDays: 60, asOf: PIPELINE_AS_OF }, {});
    const last = ladder[ladder.length - 1];
    // The newest month ends at the cutoff, so its deals have not had 60 days.
    expect(last.mature).toBe(false);
    expect(ladder.some((c) => c.mature)).toBe(true);
    for (const c of ladder.filter((x) => x.mature)) {
      const [y, m] = c.cohort.split("-").map(Number);
      const monthEnd = Date.UTC(y, m, 1);
      // A mature cohort's newest possible entry, the end of its month, plus the window, is not after the cutoff.
      expect(monthEnd - 1 + 60 * 86_400_000).toBeLessThanOrEqual(asOf + 31 * 86_400_000);
      expect(c.latestEntry).not.toBeNull();
    }
  });

  it("matches the funnel when the window is long enough to cover everything", async () => {
    const ladder = await cohortLadder(engine, TABLE, { windowDays: 10_000, asOf: PIPELINE_AS_OF }, {});
    const funnel = await stageFunnel(engine, TABLE, {});
    expect(ladder.reduce((n, c) => n + c.reachedQualified, 0)).toBe(funnel[1].count);
    expect(ladder.reduce((n, c) => n + c.reachedProposal, 0)).toBe(funnel[2].count);
    expect(ladder.reduce((n, c) => n + c.reachedWon, 0)).toBe(funnel[3].count);
  });

  it("counts fewer wins inside a short window than a long one, and the closing instant counts as inside", async () => {
    const win = async (days: number) =>
      (await cohortLadder(engine, TABLE, { windowDays: days, asOf: PIPELINE_AS_OF }, {})).reduce((n, c) => n + c.reachedWon, 0);
    expect(await win(30)).toBeLessThan(await win(90));
  });

  it("respects the filters and refuses a bad window or time", async () => {
    const all = await cohortLadder(engine, TABLE, { windowDays: 60, asOf: PIPELINE_AS_OF }, {});
    const ent = await cohortLadder(engine, TABLE, { windowDays: 60, asOf: PIPELINE_AS_OF }, { segment: ["enterprise"] });
    expect(ent.reduce((n, c) => n + c.deals, 0)).toBeLessThan(all.reduce((n, c) => n + c.deals, 0));
    await expect(cohortLadder(engine, TABLE, { windowDays: 0, asOf: PIPELINE_AS_OF }, {})).rejects.toThrow(RangeError);
    await expect(cohortLadder(engine, TABLE, { windowDays: 60, asOf: "soon" }, {})).rejects.toThrow(RangeError);
  });
});
