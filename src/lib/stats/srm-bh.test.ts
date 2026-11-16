import { describe, expect, it } from "vitest";
import { normalCdf } from "./distributions";
import { benjaminiHochberg } from "./bh";
import { SRM_THRESHOLD, sampleRatioCheck } from "./srm";

describe("sampleRatioCheck", () => {
  it("passes counts that match the planned split", () => {
    const r = sampleRatioCheck({ treatment: 5000, control: 5000 }, 0.5);
    expect(r.statistic).toBe(0);
    expect(r.pValue).toBe(1);
    expect(r.pass).toBe(true);
  });

  it("computes the chi square statistic and p value", () => {
    // Expected 5000 each. (150^2 / 5000) times 2 = 9, and P of chi square 1 above 9 = 2 P of Z below -3.
    const r = sampleRatioCheck({ treatment: 5150, control: 4850 }, 0.5);
    expect(r.statistic).toBeCloseTo(9, 12);
    expect(r.pValue).toBeCloseTo(2 * normalCdf(-3), 14);
    expect(r.pass).toBe(true);
  });

  it("flags a mismatch below the 0.001 threshold", () => {
    const r = sampleRatioCheck({ treatment: 5250, control: 4750 }, 0.5);
    expect(r.statistic).toBeCloseTo(25, 12);
    expect(r.pValue).toBeLessThan(SRM_THRESHOLD);
    expect(r.pass).toBe(false);
    expect(r.method).toMatch(/chi square/i);
  });

  it("uses an uneven planned split", () => {
    expect(sampleRatioCheck({ treatment: 9000, control: 1000 }, 0.9).pass).toBe(true);
    expect(sampleRatioCheck({ treatment: 5000, control: 5000 }, 0.9).pass).toBe(false);
  });

  it("uses 0.001 as the threshold", () => {
    expect(SRM_THRESHOLD).toBe(0.001);
  });

  it("rejects empty or impossible counts", () => {
    expect(() => sampleRatioCheck({ treatment: 0, control: 0 }, 0.5)).toThrow(RangeError);
    expect(() => sampleRatioCheck({ treatment: -1, control: 5 }, 0.5)).toThrow(RangeError);
    expect(() => sampleRatioCheck({ treatment: 5, control: 5 }, 1)).toThrow(RangeError);
  });
});

describe("benjaminiHochberg", () => {
  it("matches the known adjusted p values", () => {
    // Same as p.adjust in R with method BH: 0.02, 0.04, 0.04, 0.02.
    const r = benjaminiHochberg([0.01, 0.04, 0.03, 0.005], 0.05);
    const adjusted = r.adjusted;
    [0.02, 0.04, 0.04, 0.02].forEach((v, i) => expect(adjusted[i]).toBeCloseTo(v, 14));
    expect(r.rejected).toEqual([true, true, true, true]);
    expect(r.comparisons).toBe(4);
    expect(r.method).toMatch(/Benjamini/);
  });

  it("uses the step up rule, not a per test cutoff", () => {
    // Sorted: 0.01, 0.02, 0.03, 0.2. Cutoffs i times 0.05 over 4: 0.0125, 0.025, 0.0375, 0.05.
    const r = benjaminiHochberg([0.2, 0.03, 0.01, 0.02], 0.05);
    expect(r.rejected).toEqual([false, true, true, true]);
  });

  it("rejects nothing when no p value clears its cutoff", () => {
    const r = benjaminiHochberg([0.3, 0.5, 0.9], 0.05);
    expect(r.rejected).toEqual([false, false, false]);
  });

  it("caps adjusted values at 1 and keeps them monotone in p", () => {
    const p = [0.9, 0.5, 0.95, 0.01];
    const r = benjaminiHochberg(p, 0.05);
    for (const a of r.adjusted) expect(a).toBeLessThanOrEqual(1);
    const order = p.map((v, i) => [v, r.adjusted[i]]).sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < order.length; i++) expect(order[i][1]).toBeGreaterThanOrEqual(order[i - 1][1]);
  });

  it("handles an empty list and rejects bad p values", () => {
    expect(benjaminiHochberg([], 0.05)).toMatchObject({ adjusted: [], rejected: [], comparisons: 0 });
    expect(() => benjaminiHochberg([0.5, 1.2], 0.05)).toThrow(RangeError);
    expect(() => benjaminiHochberg([0.5, Number.NaN], 0.05)).toThrow(RangeError);
  });
});
