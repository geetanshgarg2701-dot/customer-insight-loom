import { describe, expect, it } from "vitest";
import { differenceAxis, niceStep, place, rateAxis, rateSentence, rangeSentence, rangeView, WHISKER_MIN } from "./range";

describe("the range picture", () => {
  it("puts zero in the middle and the interval where its numbers say", () => {
    // Lift 1.8 points, interval 0.6 to 3.0 points.
    const v = rangeView(0.006, 0.03, 0.018)!;
    expect(v.zeroPct).toBe(50);
    expect(v.min).toBe(-v.max);
    expect(v.at(0)).toBeCloseTo(50, 10);
    expect(v.lowPct).toBeGreaterThan(50);
    expect(v.highPct).toBeGreaterThan(v.lowPct);
    expect(v.liftPct).toBeGreaterThan(v.lowPct);
    expect(v.liftPct).toBeLessThan(v.highPct);
    expect(v.direction).toBe("above");
    expect(v.includesZero).toBe(false);
    // The axis is wide enough for the interval, with room to spare, and not absurdly wide.
    expect(v.max).toBeGreaterThanOrEqual(3);
    expect(v.max).toBeLessThanOrEqual(6);
  });

  it("scales position linearly, so equal steps in points are equal steps on the line", () => {
    const v = rangeView(0.006, 0.03, 0.018)!;
    expect(v.at(2) - v.at(1)).toBeCloseTo(v.at(3) - v.at(2), 10);
    expect(v.at(v.max)).toBeCloseTo(100, 10);
    expect(v.at(v.min)).toBeCloseTo(0, 10);
  });

  it("says when the interval spans zero or sits below it", () => {
    expect(rangeView(-0.01, 0.02, 0.005)!).toMatchObject({ direction: "spans", includesZero: true });
    expect(rangeView(-0.03, -0.01, -0.02)!).toMatchObject({ direction: "below", includesZero: false });
    // Touching zero is not ruling it out.
    expect(rangeView(0, 0.02, 0.01)!.includesZero).toBe(true);
  });

  it("uses round tick marks that include zero", () => {
    for (const [low, high, lift] of [[0.006, 0.03, 0.018], [-0.0004, 0.0009, 0.0002], [0.4, 0.9, 0.6], [-0.12, -0.03, -0.07]]) {
      const v = rangeView(low, high, lift)!;
      expect(v.ticks).toContain(0);
      expect(v.ticks[0]).toBe(v.min);
      expect(v.ticks[v.ticks.length - 1]).toBe(v.max);
      expect(v.ticks.length).toBeGreaterThanOrEqual(3);
      expect(v.ticks.length).toBeLessThanOrEqual(11);
    }
  });

  it("refuses numbers that are not a real interval", () => {
    expect(rangeView(0.03, 0.01, 0.02)).toBeNull();
    expect(rangeView(Number.NaN, 0.01, 0.0)).toBeNull();
    expect(rangeView(0, Infinity, 0)).toBeNull();
  });

  it("reads out the numbers and what they mean", () => {
    const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v * 100).toFixed(1)} points`;
    expect(rangeSentence(0.006, 0.03, 0.018, 95, signed)).toBe("Lift +1.8 points, with a 95 percent interval from +0.6 points to +3.0 points. The whole interval is above zero.");
    expect(rangeSentence(-0.01, 0.02, 0.005, 95, signed)).toContain("includes zero, so this does not rule out no effect");
    expect(rangeSentence(-0.03, -0.01, -0.02, 90, signed)).toContain("90 percent interval");
    expect(rangeSentence(-0.03, -0.01, -0.02, 90, signed)).toContain("below zero");
  });
});

/** A small deterministic generator, so a property test gives the same cases every run. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

describe("the shared axis for a table of rates", () => {
  const rows = [
    { rate: 0.421, low: 0.403, high: 0.439 },
    { rate: 0.18, low: 0.12, high: 0.25 },
    { rate: 0.05, low: 0.0, high: 0.1 },
  ];

  it("starts at zero, is labeled by round ticks, and ends at a round number above the highest range", () => {
    const axis = rateAxis(rows)!;
    expect(axis.min).toBe(0);
    expect(axis.max).toBeGreaterThanOrEqual(43.9);
    expect(axis.max).toBeLessThanOrEqual(100);
    expect(axis.ticks[0]).toBe(0);
    expect(axis.ticks[axis.ticks.length - 1]).toBe(axis.max);
    expect(axis.ticks.length).toBeGreaterThanOrEqual(3);
    expect(axis.at(0)).toBe(0);
    expect(axis.at(axis.max)).toBeCloseTo(100, 10);
  });

  it("never runs past 100 percent, however high the rates are", () => {
    expect(rateAxis([{ rate: 0.99, low: 0.97, high: 1 }])!.max).toBe(100);
    expect(rateAxis([{ rate: 1, low: 1, high: 1 }])!.max).toBe(100);
    // Labeled in round steps all the way to 100, not in two big jumps.
    expect(rateAxis([{ rate: 1, low: 0.9, high: 1 }])!.ticks).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it("is the same for every row, because it is built from all of them", () => {
    const axis = rateAxis(rows)!;
    const a = place(axis, 0.421, 0.403, 0.439)!;
    const b = place(axis, 0.18, 0.12, 0.25)!;
    // The same distance in points is the same distance on the picture in every row.
    expect((a.highPct - a.lowPct) / (0.439 - 0.403)).toBeCloseTo((b.highPct - b.lowPct) / (0.25 - 0.12), 6);
  });

  it("has nothing to draw when there are no rows or a row is not a number", () => {
    expect(rateAxis([])).toBeNull();
    expect(rateAxis([{ rate: Number.NaN, low: 0, high: 1 }])).toBeNull();
    expect(rateAxis([{ rate: 0.5, low: 0.7, high: 0.4 }])).toBeNull();
  });
});

describe("placing a rate and its range on a shared axis", () => {
  it("keeps the dot and the whisker on the axis, for any range, even one the axis was not built for", () => {
    const next = lcg(7);
    for (let i = 0; i < 400; i++) {
      const rows = Array.from({ length: 1 + Math.floor(next() * 6) }, () => {
        const a = next();
        const b = next();
        const rate = Math.min(a, b) + Math.abs(a - b) * next();
        return { rate, low: Math.min(a, b), high: Math.max(a, b) };
      });
      const axis = rateAxis(rows)!;
      for (const r of [...rows, { rate: 0.99, low: 0.9, high: 1.4 }, { rate: -0.2, low: -0.4, high: 0.1 }]) {
        const p = place(axis, r.rate, r.low, r.high)!;
        for (const v of [p.dotPct, p.lowPct, p.highPct, p.leftPct]) expect(v).toBeGreaterThanOrEqual(0);
        for (const v of [p.dotPct, p.lowPct, p.highPct]) expect(v).toBeLessThanOrEqual(100);
        expect(p.leftPct + p.widthPct).toBeLessThanOrEqual(100 + 1e-9);
      }
    }
  });

  it("still shows a mark when the range has no width", () => {
    const axis = rateAxis([{ rate: 0.3, low: 0.3, high: 0.3 }])!;
    const p = place(axis, 0.3, 0.3, 0.3)!;
    expect(WHISKER_MIN).toBe(0.8);
    expect(p.widthPct).toBeGreaterThanOrEqual(0.8);
    expect(p.dotPct).toBeGreaterThan(0);
    // At the very end of the axis too.
    const edge = place(rateAxis([{ rate: 1, low: 1, high: 1 }])!, 1, 1, 1)!;
    expect(edge.widthPct).toBeGreaterThanOrEqual(0.8);
    expect(edge.leftPct + edge.widthPct).toBeLessThanOrEqual(100 + 1e-9);
  });

  it("says when a rate's range reaches zero", () => {
    const axis = rateAxis([{ rate: 0.04, low: 0, high: 0.09 }])!;
    expect(place(axis, 0.04, 0, 0.09)!.reachesZero).toBe(true);
    expect(place(axis, 0.04, 0.01, 0.09)!.reachesZero).toBe(false);
  });
});

describe("the shared axis for a table of differences", () => {
  const rows = [
    { difference: -0.015, low: -0.03, high: 0.002 },
    { difference: 0.04, low: 0.02, high: 0.06 },
    { difference: -0.05, low: -0.07, high: -0.03 },
  ];

  it("keeps zero in the middle, shared by every row", () => {
    const axis = differenceAxis(rows)!;
    expect(axis.min).toBe(-axis.max);
    expect(axis.at(0)).toBeCloseTo(50, 10);
    expect(axis.ticks).toContain(0);
    expect(axis.max).toBeGreaterThanOrEqual(7);
  });

  it("reads a range that crosses zero as crossing, and one that does not as clear", () => {
    const axis = differenceAxis(rows)!;
    const crossing = place(axis, -0.015, -0.03, 0.002)!;
    expect(crossing.crossesZero).toBe(true);
    expect(crossing.direction).toBe("spans");
    expect(crossing.lowPct).toBeLessThan(50);
    expect(crossing.highPct).toBeGreaterThan(50);
    expect(place(axis, 0.04, 0.02, 0.06)!).toMatchObject({ crossesZero: false, direction: "above" });
    expect(place(axis, -0.05, -0.07, -0.03)!).toMatchObject({ crossesZero: false, direction: "below" });
  });

  it("touching zero counts as crossing, because it cannot rule zero out", () => {
    const axis = differenceAxis([{ difference: 0.01, low: 0, high: 0.02 }])!;
    expect(place(axis, 0.01, 0, 0.02)!.crossesZero).toBe(true);
  });

  it("keeps every row on the axis", () => {
    const axis = differenceAxis(rows)!;
    for (const r of rows) {
      const p = place(axis, r.difference, r.low, r.high)!;
      expect(Math.min(p.lowPct, p.highPct, p.dotPct)).toBeGreaterThanOrEqual(0);
      expect(Math.max(p.lowPct, p.highPct, p.dotPct)).toBeLessThanOrEqual(100);
    }
  });
});

describe("the spoken sentences", () => {
  const pct = (v: number) => `${(v * 100).toFixed(1)} percent`;
  it("gives the rate, the range and the axis in one sentence", () => {
    const axis = rateAxis([{ rate: 0.421, low: 0.403, high: 0.439 }])!;
    expect(rateSentence(0.421, 0.403, 0.439, axis, pct)).toBe(`Rate 42.1 percent, range from 40.3 percent to 43.9 percent, on an axis from 0 to ${axis.max} percent.`);
  });
  it("says when the range reaches zero", () => {
    const axis = rateAxis([{ rate: 0.04, low: 0, high: 0.09 }])!;
    expect(rateSentence(0.04, 0, 0.09, axis, pct)).toContain("The range reaches zero.");
  });
  it("shares the picking of a round step with the result picture, not a copy of it", () => {
    expect(niceStep(7)).toBe(10);
    expect(niceStep(0.13)).toBeCloseTo(0.2, 10);
    expect(niceStep(20)).toBe(20);
  });
});
