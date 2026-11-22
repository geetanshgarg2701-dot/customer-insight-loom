import { describe, expect, it } from "vitest";
import { rangeSentence, rangeView } from "./range";

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
