import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JOURNEYS_AS_OF, syntheticJourneys } from "../demo/journeys";
import { createNodeEngine } from "../intake/testing/node-engine";
import type { SqlEngine } from "../intake/types";
import { pathCounts } from "./anchored";
import { behindStep } from "./behind";
import { compareGroups } from "./compare";
import { countsBy, loadJourneys, sankeyEdges, topPaths } from "./crossfilter";
import { exampleJourney } from "./replay";
import { timeInStep } from "./timing";

/**
 * A click on a filter refreshes every journey view. Each view's query is timed on 100,000 customers, because the
 * browser update crept from 135 to 213 ms as views were added, and nobody noticed until it was measured.
 * The limits are ratios to a baseline timed at the same moment, the three count queries, so a loaded machine slows both
 * and the ratio holds. A fixed number of milliseconds failed twice in the full suite when 61 test files ran at once.
 * Each time is the best of seven runs, which load disturbs least. On 2026-11-18 on a quiet machine timing was 1.6 times
 * the baseline, before its quantile change 2.5 times, and the whole refresh 7.7 times.
 */
describe("the journey views stay fast on 100,000 customers", () => {
  let e: SqlEngine;
  beforeAll(async () => {
    e = await createNodeEngine({ isolated: true });
    await loadJourneys(e, "journeys", syntheticJourneys(100_000, 11));
  }, 120_000);
  afterAll(async () => {
    await e.close?.();
  });

  async function best(f: () => Promise<unknown>): Promise<number> {
    await f();
    let fastest = Infinity;
    for (let i = 0; i < 7; i++) {
      const t = performance.now();
      await f();
      fastest = Math.min(fastest, performance.now() - t);
    }
    return fastest;
  }

  it("keeps timing within 4 times the counts and the whole refresh within 20 times, on any machine", async () => {
    const sel = {};
    const each: Record<string, number> = {
      counts: await best(() => Promise.all(["channel", "segment", "reached"].map((d) => countsBy(e, "journeys", d, sel)))),
      flow: await best(() => sankeyEdges(e, "journeys", sel)),
      topPaths: await best(() => topPaths(e, "journeys", sel, { minShare: 0.02 })),
      pathCounts: await best(() => pathCounts(e, "journeys", sel)),
      compare: await best(() => compareGroups(e, "journeys", { dimension: "segment", a: "new", b: "returning", selection: sel })),
      timing: await best(() => timeInStep(e, "journeys", sel, { asOf: JOURNEYS_AS_OF, windowHours: 168 })),
      behind: await best(() => behindStep(e, "journeys", sel, 2)),
      replay: await best(() => exampleJourney(e, "journeys", sel, { reached: "Purchase", offset: 0 })),
    };
    const total = Object.values(each).reduce((a, b) => a + b, 0);
    const base = each.counts;
    console.log(`REFRESH SPEED ${JSON.stringify(Object.fromEntries(Object.entries(each).map(([k, v]) => [k, Math.round(v * 10) / 10])))} total ${total.toFixed(1)} ms, timing ${(each.timing / base).toFixed(1)} and total ${(total / base).toFixed(1)} times the baseline`);
    expect(each.timing / base, "timing against the baseline").toBeLessThan(4);
    expect(total / base, "whole refresh against the baseline").toBeLessThan(20);
  }, 120_000);
});
