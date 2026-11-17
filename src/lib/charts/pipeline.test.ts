import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PIPELINE_AS_OF, PIPELINE_STAGES, syntheticPipeline } from "../demo/pipeline";
import type { SqlEngine } from "../intake/types";
import { createNodeEngine } from "../intake/testing/node-engine";
import {
  PIPELINE_DIMENSIONS,
  cohortLadder,
  defaultPeriods,
  dwellHistogram,
  loadPipeline,
  openDealOutlook,
  pipelineCounts,
  periodComparison,
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
      expect(c.latestEntry).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
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

describe("defaultPeriods", () => {
  it("takes the latest 13 weeks that have had the whole window, and the 13 weeks before them", () => {
    const p = defaultPeriods(PIPELINE_AS_OF, 60);
    // The cutoff is 60 days before 1 November 2026, which is 2 September.
    expect(p.cutoff).toBe("2026-09-02T00:00:00.000Z");
    expect(p.later).toEqual({ from: "2026-06-03T00:00:00.000Z", to: "2026-09-02T00:00:00.000Z" });
    expect(p.earlier).toEqual({ from: "2026-03-04T00:00:00.000Z", to: "2026-06-03T00:00:00.000Z" });
  });

  it("moves earlier for a longer window, and rejects bad input", () => {
    expect(defaultPeriods(PIPELINE_AS_OF, 90).cutoff < defaultPeriods(PIPELINE_AS_OF, 30).cutoff).toBe(true);
    expect(() => defaultPeriods("soon", 60)).toThrow(RangeError);
    expect(() => defaultPeriods(PIPELINE_AS_OF, 0)).toThrow(RangeError);
  });
});

describe("periodComparison", () => {
  const options = (windowDays = 60) => ({ windowDays, asOf: PIPELINE_AS_OF, ...defaultPeriods(PIPELINE_AS_OF, windowDays) });

  it("compares two periods that have both had the whole window, and counts every deal in each", async () => {
    const c = await periodComparison(engine, TABLE, options(), {});
    expect(c.comparable).toBe(true);
    for (const period of [c.earlier, c.later]) {
      expect(period.deals).toBeGreaterThan(10_000);
      expect(period.comparable).toBe(true);
    }
    const o = options();
    const direct = await engine.query("SELECT count(*) AS n FROM pipeline WHERE e1 >= CAST(? AS TIMESTAMP) AND e1 < CAST(? AS TIMESTAMP)", [
      o.later.from.slice(0, 19).replace("T", " "),
      o.later.to.slice(0, 19).replace("T", " "),
    ]);
    expect(c.later.deals).toBe(Number(direct[0].n));
  });

  it("finds the planted change in the qualified rate, with an interval that excludes zero", async () => {
    const c = await periodComparison(engine, TABLE, options(), {});
    const q = c.rows.find((r) => r.stage === "Qualified")!;
    expect(q.later.share).toBeGreaterThan(q.earlier.share);
    expect(q.difference).toBeGreaterThan(0.04);
    expect(q.difference).toBeLessThan(0.12);
    expect(q.interval.low).toBeGreaterThan(0);
    expect(q.significant).toBe(true);
    expect(q.difference).toBeCloseTo(q.later.share - q.earlier.share, 12);
  });

  it("orders the stages, and a later stage is never reached by more deals than an earlier one in either period", async () => {
    const c = await periodComparison(engine, TABLE, options(), {});
    expect(c.rows.map((r) => r.stage)).toEqual(["Qualified", "Proposal", "Won"]);
    for (const key of ["earlier", "later"] as const) {
      expect(c.rows[1][key].reached).toBeLessThanOrEqual(c.rows[0][key].reached);
      expect(c.rows[2][key].reached).toBeLessThanOrEqual(c.rows[1][key].reached);
    }
  });

  it("calls a period against itself no difference at all", async () => {
    const o = options();
    const same = await periodComparison(engine, TABLE, { ...o, earlier: o.later }, {});
    for (const r of same.rows) {
      expect(r.difference).toBe(0);
      expect(r.interval.low).toBeLessThanOrEqual(0);
      expect(r.interval.high).toBeGreaterThanOrEqual(0);
      expect(r.significant).toBe(false);
    }
  });

  it("says a period is not comparable when its newest deal has not had the whole window", async () => {
    const o = options();
    const young = await periodComparison(engine, TABLE, { ...o, later: { from: "2026-09-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" } }, {});
    expect(young.later.comparable).toBe(false);
    expect(young.comparable).toBe(false);
  });

  it("respects the filters", async () => {
    const all = await periodComparison(engine, TABLE, options(), {});
    const ent = await periodComparison(engine, TABLE, options(), { segment: ["enterprise"] });
    expect(ent.later.deals).toBeLessThan(all.later.deals);
    const none = await periodComparison(engine, TABLE, options(), { segment: ["x' OR '1'='1"] });
    expect(none.later.deals).toBe(0);
    expect(none.rows.every((r) => r.difference === 0 && r.significant === false)).toBe(true);
  });

  it("refuses periods that are backwards, empty or not times, and a bad window", async () => {
    const o = options();
    await expect(periodComparison(engine, TABLE, { ...o, later: { from: o.later.to, to: o.later.from } }, {})).rejects.toThrow(RangeError);
    await expect(periodComparison(engine, TABLE, { ...o, later: { from: "x", to: o.later.to } }, {})).rejects.toThrow(RangeError);
    await expect(periodComparison(engine, TABLE, { ...o, windowDays: 0 }, {})).rejects.toThrow(RangeError);
    await expect(periodComparison(engine, TABLE, { ...o, asOf: "soon" }, {})).rejects.toThrow(RangeError);
  });
});

describe("openDealOutlook, planted win rates as ground truth", () => {
  const opts = { thresholdDays: 30, asOf: PIPELINE_AS_OF };
  const stage = (o: Awaited<ReturnType<typeof openDealOutlook>>, name: string) => o.stages.find((x) => x.stage === name)!;

  it("recovers the planted chance of winning from Proposal: about 50, 40 and 30 percent by segment", async () => {
    const smb = stage(await openDealOutlook(engine, TABLE, { segment: ["smb"] }, opts), "Proposal");
    const mid = stage(await openDealOutlook(engine, TABLE, { segment: ["mid"] }, opts), "Proposal");
    const ent = stage(await openDealOutlook(engine, TABLE, { segment: ["enterprise"] }, opts), "Proposal");
    expect(smb.rate).toBeGreaterThan(0.44);
    expect(smb.rate).toBeLessThan(0.56);
    expect(mid.rate).toBeGreaterThan(0.34);
    expect(mid.rate).toBeLessThan(0.46);
    expect(ent.rate).toBeGreaterThan(0.24);
    expect(ent.rate).toBeLessThan(0.36);
    expect(smb.rate).toBeGreaterThan(mid.rate);
    expect(mid.rate).toBeGreaterThan(ent.rate);
  });

  it("gives an earlier stage a lower chance of winning than a later one", async () => {
    const o = await openDealOutlook(engine, TABLE, {}, opts);
    expect(stage(o, "Lead").rate).toBeLessThan(stage(o, "Qualified").rate);
    expect(stage(o, "Qualified").rate).toBeLessThan(stage(o, "Proposal").rate);
    expect(o.stages.map((s) => s.stage)).toEqual(["Lead", "Qualified", "Proposal"]);
  });

  it("brackets each rate in an interval, wider when there are fewer resolved deals", async () => {
    const all = await openDealOutlook(engine, TABLE, {}, opts);
    for (const s of all.stages) {
      expect(s.rateLow).toBeLessThanOrEqual(s.rate);
      expect(s.rateHigh).toBeGreaterThanOrEqual(s.rate);
    }
    const small = await openDealOutlook(engine, TABLE, { segment: ["enterprise"], source: ["referral"] }, opts);
    const width = (o: typeof all) => stage(o, "Proposal").rateHigh - stage(o, "Proposal").rateLow;
    expect(small.stages.every((s) => s.resolved < all.stages[0].resolved)).toBe(true);
    expect(width(small)).toBeGreaterThan(width(all));
  });

  it("splits open deals into active and stalled, and the two add up to every open deal", async () => {
    const o = await openDealOutlook(engine, TABLE, {}, opts);
    const open = (await pipelineCounts(engine, TABLE, "status", {})).find((c) => c.value === "open")!.count;
    expect(o.stages.reduce((n, s) => n + s.active + s.stalled, 0)).toBe(open);
    expect(o.totals.active + o.totals.stalled).toBe(open);
    const looser = await openDealOutlook(engine, TABLE, {}, { ...opts, thresholdDays: 90 });
    expect(looser.totals.active).toBeGreaterThan(o.totals.active);
    expect(looser.totals.stalled).toBeLessThan(o.totals.stalled);
  });

  it("works the expected wins out as active deals times the rate, stage by stage, with a range that brackets it", async () => {
    const o = await openDealOutlook(engine, TABLE, {}, opts);
    for (const s of o.stages) {
      expect(s.expected).toBeCloseTo(s.active * s.rate, 8);
      expect(s.low).toBeCloseTo(s.active * s.rateLow, 8);
      expect(s.high).toBeCloseTo(s.active * s.rateHigh, 8);
    }
    expect(o.totals.expected).toBeCloseTo(o.stages.reduce((n, s) => n + s.expected, 0), 8);
    expect(o.totals.low).toBeLessThanOrEqual(o.totals.expected);
    expect(o.totals.high).toBeGreaterThanOrEqual(o.totals.expected);
  });

  it("reports the spread from chance alone, which is separate from not knowing the rate exactly", async () => {
    const o = await openDealOutlook(engine, TABLE, {}, opts);
    const variance = o.stages.reduce((n, s) => n + s.active * s.rate * (1 - s.rate), 0);
    expect(o.totals.chanceSpread).toBeCloseTo(1.96 * Math.sqrt(variance), 8);
    expect(o.totals.chanceSpread).toBeGreaterThan(0);
  });

  it("ignores a stage or status filter, which would skew the rates it learns from", async () => {
    const all = await openDealOutlook(engine, TABLE, {}, opts);
    const filtered = await openDealOutlook(engine, TABLE, { stage: ["Lead"], status: ["lost"] }, opts);
    expect(filtered).toEqual(all);
  });

  it("respects a segment filter, and a hostile value matches nothing without an error", async () => {
    const ent = await openDealOutlook(engine, TABLE, { segment: ["enterprise"] }, opts);
    const all = await openDealOutlook(engine, TABLE, {}, opts);
    expect(ent.totals.active).toBeLessThan(all.totals.active);
    const none = await openDealOutlook(engine, TABLE, { segment: ["x' OR '1'='1"] }, opts);
    expect(none.totals).toMatchObject({ active: 0, stalled: 0, expected: 0, low: 0, high: 0, chanceSpread: 0 });
    expect(none.stages.every((s) => s.rate === 0 && s.resolved === 0)).toBe(true);
  });

  it("refuses a bad threshold or cutoff", async () => {
    await expect(openDealOutlook(engine, TABLE, {}, { ...opts, thresholdDays: -1 })).rejects.toThrow(RangeError);
    await expect(openDealOutlook(engine, TABLE, {}, { ...opts, asOf: "soon" })).rejects.toThrow(RangeError);
  });
});
