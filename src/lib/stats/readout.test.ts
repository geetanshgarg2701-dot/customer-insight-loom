import { describe, expect, it } from "vitest";
import {
  incrementalRevenue,
  newcombeDifference,
  readout,
  twoProportionPValue,
  wilsonInterval,
} from "./readout";

describe("wilsonInterval", () => {
  it("matches the worked value for 9 of 10", () => {
    const { low, high } = wilsonInterval(9, 10, 0.05);
    expect(low).toBeCloseTo(0.5958, 4);
    expect(high).toBeCloseTo(0.9821, 4);
  });

  it("stays inside 0 to 1 at the edges", () => {
    expect(wilsonInterval(0, 29, 0.05).low).toBe(0);
    expect(wilsonInterval(29, 29, 0.05).high).toBe(1);
  });
});

describe("newcombeDifference, method 10 in Newcombe 1998", () => {
  // Treatment first, control second. Expected intervals from the paper's examples.
  it.each([
    ["56/70 vs 48/80", 56, 70, 48, 80, 0.0524, 0.3339],
    ["9/10 vs 3/10", 9, 10, 3, 10, 0.1705, 0.809],
    // Checked by hand from the two Wilson intervals, 0.4869 to 0.9743 and 0.0822 to 0.6411.
    ["6/7 vs 2/7", 6, 7, 2, 7, 0.0582, 0.8062],
    ["5/56 vs 0/29", 5, 56, 0, 29, -0.0381, 0.1926],
  ])("%s", (_label, x1, n1, x2, n2, low, high) => {
    const ci = newcombeDifference(x1, n1, x2, n2, 0.05);
    expect(ci.low).toBeCloseTo(low, 4);
    expect(ci.high).toBeCloseTo(high, 4);
  });

  it("is symmetric when the arms swap", () => {
    const a = newcombeDifference(30, 200, 20, 210, 0.05);
    const b = newcombeDifference(20, 210, 30, 200, 0.05);
    expect(a.low).toBeCloseTo(-b.high, 14);
    expect(a.high).toBeCloseTo(-b.low, 14);
  });
});

describe("twoProportionPValue", () => {
  it("matches the pooled z test for 9/10 vs 3/10", () => {
    // z = 0.6 / sqrt(0.6 * 0.4 * 0.2) = 2.7386, two sided p about 0.00617
    expect(twoProportionPValue(9, 10, 3, 10)).toBeCloseTo(0.00617, 4);
  });

  it("returns 1 when there is no variation at all", () => {
    expect(twoProportionPValue(0, 50, 0, 60)).toBe(1);
    expect(twoProportionPValue(50, 50, 60, 60)).toBe(1);
  });
});

describe("readout", () => {
  it("reports lift as treatment rate minus control rate with its method", () => {
    const r = readout({ treatment: { n: 10, conversions: 9 }, control: { n: 10, conversions: 3 } });
    expect(r.treatmentRate).toBeCloseTo(0.9, 14);
    expect(r.controlRate).toBeCloseTo(0.3, 14);
    expect(r.lift).toBeCloseTo(0.6, 14);
    expect(r.interval.low).toBeCloseTo(0.1705, 4);
    expect(r.interval.high).toBeCloseTo(0.809, 4);
    expect(r.significant).toBe(true);
    expect(r.alpha).toBe(0.05);
    expect(r.method).toMatch(/Newcombe/);
    expect(r.engineVersion).toMatch(/^\d+$/);
  });

  it("calls a result not significant when the interval includes zero", () => {
    const r = readout({ treatment: { n: 56, conversions: 5 }, control: { n: 29, conversions: 0 } });
    expect(r.interval.low).toBeLessThan(0);
    expect(r.significant).toBe(false);
  });

  it("rejects impossible counts", () => {
    const bad = [
      { treatment: { n: 0, conversions: 0 }, control: { n: 10, conversions: 1 } },
      { treatment: { n: 10, conversions: 11 }, control: { n: 10, conversions: 1 } },
      { treatment: { n: 10, conversions: -1 }, control: { n: 10, conversions: 1 } },
      { treatment: { n: 10.5, conversions: 1 }, control: { n: 10, conversions: 1 } },
    ];
    for (const input of bad) expect(() => readout(input)).toThrow(RangeError);
  });
});

describe("incrementalRevenue", () => {
  it("multiplies lift and its interval by treated audience and order value", () => {
    const rev = incrementalRevenue(
      { lift: 0.02, interval: { low: 0.01, high: 0.03 } },
      10_000,
      50,
    );
    expect(rev.estimate).toBeCloseTo(10_000, 8);
    expect(rev.low).toBeCloseTo(5_000, 8);
    expect(rev.high).toBeCloseTo(15_000, 8);
    expect(rev.note).toMatch(/order values vary/);
  });
});
