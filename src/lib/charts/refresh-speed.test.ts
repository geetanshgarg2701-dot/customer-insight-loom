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
 * The limits are loose on purpose, about three times what a quiet machine measured on 2026-11-18, so a loaded test
 * run does not fail but a view that gets several times slower does.
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

  async function median(f: () => Promise<unknown>): Promise<number> {
    await f();
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      await f();
      runs.push(performance.now() - t);
    }
    return runs.sort((a, b) => a - b)[2];
  }

  it("keeps timing under 40 ms and the whole refresh under 450 ms, in plain Node", async () => {
    const sel = {};
    const each: Record<string, number> = {
      counts: await median(() => Promise.all(["channel", "segment", "reached"].map((d) => countsBy(e, "journeys", d, sel)))),
      flow: await median(() => sankeyEdges(e, "journeys", sel)),
      topPaths: await median(() => topPaths(e, "journeys", sel, { minShare: 0.02 })),
      pathCounts: await median(() => pathCounts(e, "journeys", sel)),
      compare: await median(() => compareGroups(e, "journeys", { dimension: "segment", a: "new", b: "returning", selection: sel })),
      timing: await median(() => timeInStep(e, "journeys", sel, { asOf: JOURNEYS_AS_OF, windowHours: 168 })),
      behind: await median(() => behindStep(e, "journeys", sel, 2)),
      replay: await median(() => exampleJourney(e, "journeys", sel, { reached: "Purchase", offset: 0 })),
    };
    const total = Object.values(each).reduce((a, b) => a + b, 0);
    console.log(`REFRESH SPEED ${JSON.stringify(Object.fromEntries(Object.entries(each).map(([k, v]) => [k, Math.round(v * 10) / 10])))} total ${total.toFixed(1)} ms`);
    expect(each.timing, "timing").toBeLessThan(40);
    expect(total, "whole refresh").toBeLessThan(450);
  }, 120_000);
});
