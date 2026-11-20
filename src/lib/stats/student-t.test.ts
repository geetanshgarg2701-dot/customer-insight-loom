import { describe, expect, it } from "vitest";
import { regularizedBeta, studentTCdf, studentTQuantile } from "./distributions";

// Reference values from standard t tables and R: qt(0.975, df), pt(t, df), pbeta(x, a, b).
describe("Student t distribution", () => {
  it.each([
    [1, 12.706204736],
    [2, 4.302652730],
    [4, 2.776445105],
    [10, 2.228138852],
    [30, 2.042272456],
    [200, 1.971896224],
  ])("the 97.5 percent quantile with %i degrees of freedom is %f", (df, q) => {
    expect(studentTQuantile(0.975, df)).toBeCloseTo(q, 6);
    expect(studentTQuantile(0.025, df)).toBeCloseTo(-q, 6);
  });

  it.each([
    [2, 5, 0.9490302605],
    // df 3 has a closed form, 1/2 + (t / (root 3 (1 + t^2/3)) + atan(t / root 3)) / pi.
    [-1.5, 3, 0.1152919326],
    [0, 7, 0.5],
    [3, 1, 0.8975836176],
  ])("the CDF at %f with %i degrees of freedom is %f", (t, df, p) => {
    expect(studentTCdf(t, df)).toBeCloseTo(p, 8);
  });

  it("approaches the normal as the degrees of freedom grow", () => {
    expect(studentTQuantile(0.975, 1e6)).toBeCloseTo(1.959964, 4);
  });

  it("the quantile inverts the CDF", () => {
    for (const df of [1, 3, 9, 40]) {
      for (const p of [0.01, 0.2, 0.5, 0.9, 0.999]) expect(studentTCdf(studentTQuantile(p, df), df)).toBeCloseTo(p, 9);
    }
  });

  it("refuses bad inputs", () => {
    expect(() => studentTQuantile(0, 3)).toThrow(RangeError);
    expect(() => studentTQuantile(0.5, 0)).toThrow(RangeError);
    expect(() => studentTCdf(1, -1)).toThrow(RangeError);
  });
});

describe("regularized incomplete beta", () => {
  it.each([
    [0.5, 2, 3, 0.6875],
    [0.2, 0.5, 0.5, 0.2951672353],
    [0.9, 5, 1, 0.59049],
    [0, 2, 2, 0],
    [1, 2, 2, 1],
  ])("I at %f with a %f and b %f is %f", (x, a, b, v) => {
    expect(regularizedBeta(x, a, b)).toBeCloseTo(v, 9);
  });
});
