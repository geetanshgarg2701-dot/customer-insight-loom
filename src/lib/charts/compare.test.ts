import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JOURNEY_STEPS, syntheticJourneys, type JourneyRow } from "../demo/journeys";
import { createNodeEngine } from "../intake/testing/node-engine";
import type { SqlEngine } from "../intake/types";
import { newcombeDifference, wilsonInterval } from "../stats/readout";
import { compareGroups, differenceSentence, MIN_GROUP } from "./compare";
import { loadJourneys } from "./crossfilter";

/** A customer who reached the first `reached` steps. */
function customer(segment: JourneyRow["segment"], channel: JourneyRow["channel"], reached: number): JourneyRow {
  const steps = JOURNEY_STEPS.map((s, i) => (i < reached ? s : null));
  return { segment, channel, steps, reached: JOURNEY_STEPS[reached - 1], path: JOURNEY_STEPS.slice(0, reached) as string[] };
}

/** `count` customers who stopped after step `reached`. */
const many = (count: number, segment: JourneyRow["segment"], channel: JourneyRow["channel"], reached: number) =>
  Array.from({ length: count }, () => customer(segment, channel, reached));

let engine: SqlEngine;
afterAll(async () => {
  await engine.close?.();
});

describe("compareGroups on counts worked out by hand", () => {
  // Group "new", 200 people: 40 stop at Visit, 60 at Product, 50 at Cart, 50 buy.
  //   reached Visit 200, Product 160, Cart 100, Purchase 50.
  //   step rates: 160 of 200, 100 of 160, 50 of 100.
  // Group "returning", 100 people: 10 stop at Visit, 10 at Product, 30 at Cart, 50 buy.
  //   reached 100, 90, 80, 50. Step rates: 90 of 100, 80 of 90, 50 of 80.
  const rows = [
    ...many(40, "new", "ads", 1),
    ...many(60, "new", "ads", 2),
    ...many(50, "new", "email", 3),
    ...many(50, "new", "email", 4),
    ...many(10, "returning", "ads", 1),
    ...many(10, "returning", "ads", 2),
    ...many(30, "returning", "email", 3),
    ...many(50, "returning", "email", 4),
  ];

  beforeAll(async () => {
    engine = await createNodeEngine();
    await loadJourneys(engine, "journeys", rows);
  });

  it("counts people who reached each step, per group", async () => {
    const c = await compareGroups(engine, "journeys", { dimension: "segment", a: "new", b: "returning", selection: {} });
    expect(c.a.value).toBe("new");
    expect(c.a.entered).toBe(200);
    expect(c.a.reached).toEqual([200, 160, 100, 50]);
    expect(c.b.entered).toBe(100);
    expect(c.b.reached).toEqual([100, 90, 80, 50]);
  });

  it("gives each step rate as people who went on over people who reached the step before, with a Wilson interval", async () => {
    const c = await compareGroups(engine, "journeys", { dimension: "segment", a: "new", b: "returning", selection: {} });
    expect(c.a.rates.map((r) => [r.from, r.to])).toEqual([[200, 160], [160, 100], [100, 50]]);
    expect(c.a.rates.map((r) => r.step)).toEqual(["Visit to Product", "Product to Cart", "Cart to Purchase"]);
    expect(c.a.rates[0].rate).toBeCloseTo(0.8, 12);
    expect(c.a.rates[1].rate).toBeCloseTo(100 / 160, 12);
    const w = wilsonInterval(100, 160, 0.05);
    expect(c.a.rates[1].low).toBeCloseTo(w.low, 12);
    expect(c.a.rates[1].high).toBeCloseTo(w.high, 12);
  });

  it("gives the difference between the groups with the Newcombe interval, and says whether it excludes zero", async () => {
    const c = await compareGroups(engine, "journeys", { dimension: "segment", a: "new", b: "returning", selection: {} });
    expect(c.differences).toHaveLength(3);
    const second = c.differences[1];
    expect(second.step).toBe("Product to Cart");
    expect(second.difference).toBeCloseTo(100 / 160 - 80 / 90, 12);
    const n = newcombeDifference(100, 160, 80, 90, 0.05);
    expect(second.low).toBeCloseTo(n.low, 12);
    expect(second.high).toBeCloseTo(n.high, 12);
    expect(second.excludesZero).toBe(n.low > 0 || n.high < 0);
    // The third step, 50 of 100 against 50 of 80, is a real gap that the interval should catch.
    const third = c.differences[2];
    expect(third.difference).toBeCloseTo(0.5 - 0.625, 12);
  });

  it("states how many comparisons were made and labels the results exploratory and association", async () => {
    const c = await compareGroups(engine, "journeys", { dimension: "segment", a: "new", b: "returning", selection: {} });
    expect(c.comparisons).toBe(3);
    expect(c.note).toContain("Comparisons made: 3.");
    expect(c.note).toContain("exploratory");
    expect(c.note).toContain("association");
    expect(c.note).toContain("not cause");
    expect(c.note).not.toMatch(/[—()]/);
  });

  it("warns when a group is under the minimum size, and the rule is the stated number", async () => {
    expect(MIN_GROUP).toBe(30);
    const small = [...many(10, "vip", "ads", 2), ...many(10, "vip", "ads", 4)];
    const e2 = await createNodeEngine();
    await loadJourneys(e2, "journeys", [...rows, ...small]);
    const c = await compareGroups(e2, "journeys", { dimension: "segment", a: "new", b: "vip", selection: {} });
    expect(c.a.tooSmall).toBe(false);
    expect(c.b.tooSmall).toBe(true);
    expect(c.b.entered).toBe(20);
    await e2.close?.();
  });

  it("ignores the compared dimension in the selection, and honors every other filter", async () => {
    // Selecting channel email leaves only the people who reached Cart or Purchase in this data.
    const c = await compareGroups(engine, "journeys", {
      dimension: "segment",
      a: "new",
      b: "returning",
      selection: { channel: ["email"], segment: ["vip"] },
    });
    expect(c.a.entered).toBe(100);
    expect(c.b.entered).toBe(80);
    expect(c.a.reached).toEqual([100, 100, 100, 50]);
  });

  it("leaves out a step difference when a group has nobody to measure it on, and does not count it", async () => {
    const e3 = await createNodeEngine();
    await loadJourneys(e3, "journeys", [...many(40, "new", "ads", 1), ...many(40, "returning", "ads", 4)]);
    const c = await compareGroups(e3, "journeys", { dimension: "segment", a: "new", b: "returning", selection: {} });
    expect(c.a.rates[0]).toMatchObject({ from: 40, to: 0, rate: 0 });
    expect(c.a.rates[1]).toMatchObject({ from: 0, to: 0, rate: null, low: null, high: null });
    expect(c.differences.map((d) => d.step)).toEqual(["Visit to Product"]);
    expect(c.comparisons).toBe(1);
    await e3.close?.();
  });

  it("refuses a bad dimension, the same group twice, or a bad table name, instead of building SQL from them", async () => {
    await expect(
      compareGroups(engine, "journeys", { dimension: "reached" as never, a: "x", b: "y", selection: {} }),
    ).rejects.toThrow(RangeError);
    await expect(
      compareGroups(engine, "journeys", { dimension: "segment", a: "new", b: "new", selection: {} }),
    ).rejects.toThrow(RangeError);
    await expect(
      compareGroups(engine, "journeys; DROP TABLE journeys", { dimension: "segment", a: "new", b: "returning", selection: {} }),
    ).rejects.toThrow(RangeError);
    // A value that looks like SQL is only bound as a parameter, so it matches nobody.
    const c = await compareGroups(engine, "journeys", { dimension: "segment", a: "new", b: "x' OR '1'='1", selection: {} });
    expect(c.b.entered).toBe(0);
  });
});

describe("compareGroups against the synthetic generator, counted a second way", () => {
  const generated = syntheticJourneys(20_000, 11);
  let e: SqlEngine;

  beforeAll(async () => {
    e = await createNodeEngine();
    await loadJourneys(e, "journeys", generated);
  }, 120_000);
  afterAll(async () => {
    await e.close?.();
  });

  it("matches a direct count in plain code for segment and for channel", async () => {
    for (const [dimension, a, b] of [
      ["segment", "new", "returning"],
      ["channel", "ads", "email"],
    ] as const) {
      const c = await compareGroups(e, "journeys", { dimension, a, b, selection: {} });
      for (const group of [c.a, c.b]) {
        const mine = generated.filter((r) => r[dimension] === group.value);
        expect(group.entered).toBe(mine.length);
        expect(group.reached).toEqual(JOURNEY_STEPS.map((_, i) => mine.filter((r) => r.steps[i] !== null).length));
      }
    }
  });

  it("finds the planted gap: new customers who reach the cart buy far less often than returning ones", async () => {
    const c = await compareGroups(e, "journeys", { dimension: "segment", a: "new", b: "returning", selection: {} });
    const last = c.differences.find((d) => d.step === "Cart to Purchase")!;
    expect(last.difference).toBeLessThan(-0.25);
    expect(last.excludesZero).toBe(true);
    // Visit to Product was not planted to differ by segment, so the interval should include zero.
    const first = c.differences.find((d) => d.step === "Visit to Product")!;
    expect(Math.abs(first.difference)).toBeLessThan(0.05);
  });
});

describe("differenceSentence, the plain reading next to every range", () => {
  const hand = [
    ...many(40, "new", "ads", 1),
    ...many(60, "new", "ads", 2),
    ...many(50, "new", "email", 3),
    ...many(50, "new", "email", 4),
    ...many(10, "returning", "ads", 1),
    ...many(10, "returning", "ads", 2),
    ...many(30, "returning", "email", 3),
    ...many(50, "returning", "email", 4),
  ];

  it("says who went on, the gap in points, the interval, and that it is exploratory", async () => {
    const e = await createNodeEngine();
    await loadJourneys(e, "journeys", hand);
    const c = await compareGroups(e, "journeys", { dimension: "segment", a: "new", b: "returning", selection: {} });
    const s = differenceSentence(c, c.differences[1]);
    expect(s).toContain("Of people who reached Product, 62.5 percent of new went on to Cart, against 88.9 percent of returning.");
    expect(s).toContain("The gap is -26.4 points");
    expect(s).toContain("95 percent interval of");
    expect(s).toContain("exploratory");
    expect(s).not.toMatch(/[\u2014()]/);
    await e.close?.();
  });

  it("says plainly when the interval includes zero, so it does not show a gap", async () => {
    const e = await createNodeEngine();
    await loadJourneys(e, "journeys", [...many(20, "new", "ads", 4), ...many(20, "returning", "ads", 4), ...many(5, "new", "ads", 1), ...many(5, "returning", "ads", 1)]);
    const c = await compareGroups(e, "journeys", { dimension: "segment", a: "new", b: "returning", selection: {} });
    const first = c.differences[0];
    expect(first.excludesZero).toBe(false);
    expect(differenceSentence(c, first)).toContain("The interval includes zero, so this does not show a gap.");
    await e.close?.();
  });

  it("says the interval excludes zero when it does, without claiming a cause", async () => {
    const e = await createNodeEngine();
    await loadJourneys(e, "journeys", hand);
    const c = await compareGroups(e, "journeys", { dimension: "segment", a: "new", b: "returning", selection: {} });
    const wide = c.differences[1];
    expect(wide.excludesZero).toBe(true);
    const s = differenceSentence(c, wide);
    expect(s).toContain("The interval excludes zero.");
    expect(s).toContain("association");
    expect(s).not.toMatch(/\bbecause\b|\bcaused\b/);
    await e.close?.();
  });
});
