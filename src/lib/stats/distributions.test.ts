import { describe, expect, it } from "vitest";
import {
  binomialCdf,
  binomialCentralRange,
  chiSquareSurvival,
  lnGamma,
  normalCdf,
  normalQuantile,
  regularizedGammaP,
  regularizedGammaQ,
} from "./distributions";

/** Relative closeness, for values that span many orders of magnitude. */
function expectRelClose(actual: number, expected: number, rel = 1e-9) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.abs(expected) * rel);
}

describe("lnGamma", () => {
  it.each([
    [0.5, 0.5723649429247001],
    [1, 0],
    [2, 0],
    [10, 12.801827480081469],
    [100, 359.1342053695754],
  ])("lnGamma(%s)", (x, expected) => {
    expect(lnGamma(x)).toBeCloseTo(expected, 12);
  });
});

describe("regularized incomplete gamma", () => {
  it("matches 1 minus e to the minus x when a is 1", () => {
    expect(regularizedGammaP(1, 2)).toBeCloseTo(1 - Math.exp(-2), 14);
  });

  it("matches erf when a is one half", () => {
    // P of one half and x squared equals erf of x. erf of 1 = 0.8427007929497149.
    expect(regularizedGammaP(0.5, 1)).toBeCloseTo(0.8427007929497149, 14);
  });

  it("P and Q add to 1", () => {
    for (const [a, x] of [[0.5, 0.1], [3, 2], [10, 15], [50, 40]]) {
      expect(regularizedGammaP(a, x) + regularizedGammaQ(a, x)).toBeCloseTo(1, 14);
    }
  });
});

describe("normalCdf", () => {
  it.each([
    [0, 0.5],
    [1.96, 0.9750021048517795],
    [-1, 0.15865525393145707],
    [-3, 0.0013498980316301035],
  ])("normalCdf(%s)", (x, expected) => {
    expect(normalCdf(x)).toBeCloseTo(expected, 14);
  });

  it("stays accurate far into the lower tail", () => {
    expectRelClose(normalCdf(-8), 6.220960574271785e-16, 1e-9);
  });

  it("is symmetric", () => {
    for (const x of [0.3, 1.2, 2.5, 4]) {
      expect(normalCdf(x) + normalCdf(-x)).toBeCloseTo(1, 14);
    }
  });
});

describe("normalQuantile", () => {
  it.each([
    [0.5, 0],
    [0.975, 1.959963984540054],
    [0.025, -1.959963984540054],
    [0.8, 0.8416212335729143],
    [0.999, 3.090232306167813],
  ])("normalQuantile(%s)", (p, expected) => {
    expect(normalQuantile(p)).toBeCloseTo(expected, 12);
  });

  it("works deep in the tail", () => {
    expectRelClose(normalQuantile(1e-10), -6.361340902404056, 1e-10);
  });

  it("inverts normalCdf", () => {
    for (const p of [0.001, 0.2, 0.5, 0.77, 0.9999]) {
      expect(normalCdf(normalQuantile(p))).toBeCloseTo(p, 14);
    }
  });

  it("rejects probabilities outside 0 to 1", () => {
    for (const p of [0, 1, -0.1, 1.1, Number.NaN]) {
      expect(() => normalQuantile(p)).toThrow(RangeError);
    }
  });
});

describe("chiSquareSurvival", () => {
  it.each([
    [3.841458820694124, 1, 0.05],
    [10.827566170662733, 1, 0.001],
    [5.991464547107979, 2, 0.05],
    [7.814727903251178, 3, 0.05],
  ])("critical value %s with %s df gives %s", (x, df, expected) => {
    expect(chiSquareSurvival(x, df)).toBeCloseTo(expected, 12);
  });

  it("is 1 at zero", () => {
    expect(chiSquareSurvival(0, 1)).toBe(1);
  });

  it("matches the normal tail for 1 df", () => {
    // P of chi square 1 above 9 equals 2 times P of Z above 3.
    expect(chiSquareSurvival(9, 1)).toBeCloseTo(2 * normalCdf(-3), 14);
  });
});

describe("binomial", () => {
  it("matches exact small cases", () => {
    // 638 of 1024 outcomes have 5 or fewer heads in 10 fair flips.
    expect(binomialCdf(5, 10, 0.5)).toBeCloseTo(638 / 1024, 13);
    expect(binomialCdf(0, 3, 0.2)).toBeCloseTo(0.512, 14);
    expect(binomialCdf(3, 3, 0.2)).toBe(1);
    expect(binomialCdf(-1, 3, 0.2)).toBe(0);
  });

  it("returns the central 95 percent range by its definition", () => {
    const n = 1000;
    const p = 0.05;
    const { low, high } = binomialCentralRange(n, p, 0.95);
    expect(binomialCdf(low - 1, n, p)).toBeLessThan(0.025);
    expect(binomialCdf(low, n, p)).toBeGreaterThanOrEqual(0.025);
    expect(binomialCdf(high - 1, n, p)).toBeLessThan(0.975);
    expect(binomialCdf(high, n, p)).toBeGreaterThanOrEqual(0.975);
  });
});
