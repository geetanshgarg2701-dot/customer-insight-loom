import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JOURNEY_STEPS, JOURNEYS_AS_OF, syntheticJourneys, type JourneyRow } from "../demo/journeys";
import { createNodeEngine } from "../intake/testing/node-engine";
import type { SqlEngine } from "../intake/types";
import { loadJourneys } from "./crossfilter";
import { timeInStep } from "./timing";

const HOUR = 3_600_000;
const T0 = Date.parse("2026-07-01T00:00:00.000Z");

/** A customer on the main steps only, with the given hours between steps, entering at `enter` hours after T0. */
function customer(segment: JourneyRow["segment"], enter: number, gaps: number[]): JourneyRow {
  const path = JOURNEY_STEPS.slice(0, gaps.length + 1) as string[];
  let t = T0 + enter * HOUR;
  const times = [new Date(t).toISOString()];
  for (const g of gaps) {
    t += g * HOUR;
    times.push(new Date(t).toISOString());
  }
  const steps = JOURNEY_STEPS.map((s, i) => (i < path.length ? s : null));
  return { segment, channel: "ads", steps, reached: path[path.length - 1], path, times };
}

describe("loadJourneys stores the times", () => {
  it("keeps one UTC millisecond time per main step, and the whole path's times, per customer", async () => {
    const e = await createNodeEngine();
    await loadJourneys(e, "journeys", [customer("new", 0, [1, 2])]);
    const [row] = await e.query("SELECT customer, t1, t2, t3, t4, times FROM journeys", []);
    expect(Number(row.customer)).toBe(0);
    expect(Number(row.t1)).toBe(T0);
    expect(Number(row.t2)).toBe(T0 + HOUR);
    expect(Number(row.t3)).toBe(T0 + 3 * HOUR);
    expect(row.t4).toBeNull();
    expect(String(row.times).split(" > ")).toHaveLength(3);
    await e.close?.();
  });
});

describe("timeInStep on times worked out by hand", () => {
  // Four people go from Visit to Product after 1, 2, 3 and 4 hours. Two of them go on to Cart, after 10 and 30 hours.
  // Two more stop at Visit: one entered long before the cutoff, so their window has closed, and one entered an hour
  // before the cutoff, so they are still inside a 168 hour window and must not count as dropped.
  const asOf = new Date(T0 + 1000 * HOUR).toISOString();
  const rows = [
    customer("new", 0, [1, 10]),
    customer("new", 0, [2]),
    customer("new", 0, [3, 30]),
    customer("new", 0, [4]),
    customer("new", 0, []),
    customer("new", 999, []),
  ];
  let e: SqlEngine;
  beforeAll(async () => {
    e = await createNodeEngine();
    await loadJourneys(e, "journeys", rows);
  });
  afterAll(async () => {
    await e.close?.();
  });

  it("gives the median and quartiles of the hours between steps, computed in SQL", async () => {
    const t = await timeInStep(e, "journeys", {}, { asOf, windowHours: 168 });
    const first = t.steps[0];
    expect(first.step).toBe("Visit to Product");
    expect(first.moved).toBe(4);
    // Linear interpolation between the sorted values 1, 2, 3, 4.
    expect(first.medianHours).toBeCloseTo(2.5, 9);
    expect(first.p25Hours).toBeCloseTo(1.75, 9);
    expect(first.p75Hours).toBeCloseTo(3.25, 9);
    const second = t.steps[1];
    expect(second.moved).toBe(2);
    expect(second.medianHours).toBeCloseTo(20, 9);
  });

  it("shows people whose window is still open apart from people who dropped, instead of counting them as dropped", async () => {
    const t = await timeInStep(e, "journeys", {}, { asOf, windowHours: 168 });
    const first = t.steps[0];
    expect(first.waiting).toBe(1);
    expect(first.dropped).toBe(1);
    // Everyone who reached Visit is accounted for once: moved on, still waiting, or dropped.
    expect(first.moved + first.waiting + first.dropped).toBe(6);
    expect(t.windowHours).toBe(168);
    expect(t.asOf).toBe(asOf);
  });

  it("reports no times for a step nobody moved through, instead of inventing them", async () => {
    const t = await timeInStep(e, "journeys", {}, { asOf, windowHours: 168 });
    const last = t.steps[2];
    expect(last.step).toBe("Cart to Purchase");
    expect(last.moved).toBe(0);
    expect(last.medianHours).toBeNull();
    expect(last.p25Hours).toBeNull();
  });

  it("refuses a bad window, a bad cutoff, or a bad table name", async () => {
    await expect(timeInStep(e, "journeys", {}, { asOf, windowHours: 0 })).rejects.toThrow(RangeError);
    await expect(timeInStep(e, "journeys", {}, { asOf: "soon", windowHours: 168 })).rejects.toThrow(RangeError);
    await expect(timeInStep(e, "journeys; DROP TABLE journeys", {}, { asOf, windowHours: 168 })).rejects.toThrow(RangeError);
  });
});

describe("timeInStep on the generator, counted a second way", () => {
  const generated = syntheticJourneys(20_000, 11);
  let e: SqlEngine;
  beforeAll(async () => {
    e = await createNodeEngine();
    await loadJourneys(e, "journeys", generated);
  }, 120_000);
  afterAll(async () => {
    await e.close?.();
  });

  /** Hours from main step i to main step i + 1, in plain code, for people who made it. */
  function hours(rows: JourneyRow[], i: number): number[] {
    return rows
      .filter((r) => r.steps[i + 1] !== null)
      .map((r) => {
        const a = r.times[r.path.indexOf(JOURNEY_STEPS[i])];
        const b = r.times[r.path.indexOf(JOURNEY_STEPS[i + 1])];
        return (Date.parse(b) - Date.parse(a)) / HOUR;
      })
      .sort((x, y) => x - y);
  }
  /** The same interpolated quantile DuckDB uses for quantile_cont. */
  function quantile(sorted: number[], q: number): number {
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (pos - lo);
  }

  it("matches a plain code count and median for every step", async () => {
    const t = await timeInStep(e, "journeys", {}, { asOf: JOURNEYS_AS_OF, windowHours: 168 });
    t.steps.forEach((s, i) => {
      const list = hours(generated, i);
      expect(s.moved, s.step).toBe(list.length);
      expect(s.medianHours!, s.step).toBeCloseTo(quantile(list, 0.5), 6);
      expect(s.p75Hours!, s.step).toBeCloseTo(quantile(list, 0.75), 6);
    });
  });

  it("has no one still waiting in the demo, because every window has closed by the cutoff", async () => {
    const t = await timeInStep(e, "journeys", {}, { asOf: JOURNEYS_AS_OF, windowHours: 168 });
    for (const s of t.steps) expect(s.waiting).toBe(0);
  });

  it("finds the planted timing fact through the segment filter: new customers take about twice as long to buy", async () => {
    const slow = await timeInStep(e, "journeys", { segment: ["new"] }, { asOf: JOURNEYS_AS_OF, windowHours: 168 });
    const fast = await timeInStep(e, "journeys", { segment: ["returning"] }, { asOf: JOURNEYS_AS_OF, windowHours: 168 });
    const ratio = slow.steps[2].medianHours! / fast.steps[2].medianHours!;
    expect(ratio).toBeGreaterThan(1.7);
    expect(ratio).toBeLessThan(2.3);
  });
});
