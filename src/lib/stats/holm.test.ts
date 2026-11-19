import { describe, expect, it } from "vitest";
import { benjaminiHochberg } from "./bh";
import { mulberry32 } from "./honesty";
import { holm } from "./holm";

describe("holm, hand checked", () => {
  it("matches the plan's own example: Benjamini Hochberg flags all three, Holm only the first", () => {
    // Plan part B, section 6: p values 0.012, 0.03 and 0.04 at 0.05.
    // Holm by hand, sorted p times the number of tests still left: 0.012 times 3 is 0.036, a pass. 0.03 times 2 is 0.06,
    // a fail, so Holm stops and the rest are not flagged. Adjusted values carry the running maximum: 0.036, 0.06, 0.06.
    const p = [0.012, 0.03, 0.04];
    const h = holm(p, 0.05);
    expect(h.rejected).toEqual([true, false, false]);
    [0.036, 0.06, 0.06].forEach((v, i) => expect(h.adjusted[i]).toBeCloseTo(v, 12));
    expect(benjaminiHochberg(p, 0.05).rejected).toEqual([true, true, true]);
  });

  it("keeps the input order and matches p.adjust in R with method holm", () => {
    // R: p.adjust(c(0.01, 0.04, 0.03, 0.005), "holm") gives 0.03, 0.06, 0.06, 0.02.
    const h = holm([0.01, 0.04, 0.03, 0.005], 0.05);
    [0.03, 0.06, 0.06, 0.02].forEach((v, i) => expect(h.adjusted[i]).toBeCloseTo(v, 12));
    expect(h.rejected).toEqual([true, false, false, true]);
    expect(h.comparisons).toBe(4);
  });

  it("caps adjusted values at 1", () => {
    expect(holm([0.6, 0.7], 0.05).adjusted).toEqual([1, 1]);
  });

  it("names its method, how many comparisons, and the level", () => {
    const h = holm([0.01, 0.2], 0.05);
    expect(h.method).toContain("Holm");
    expect(h.method).toContain("2 comparisons");
    expect(h.method).not.toMatch(/[—()]/);
  });

  it("handles no comparisons, and refuses a bad p value or level", () => {
    expect(holm([], 0.05)).toMatchObject({ adjusted: [], rejected: [], comparisons: 0 });
    expect(() => holm([0.5, 1.2], 0.05)).toThrow(RangeError);
    expect(() => holm([0.5, Number.NaN], 0.05)).toThrow(RangeError);
    expect(() => holm([0.5], 0)).toThrow(RangeError);
    expect(() => holm([0.5], 1)).toThrow(RangeError);
  });
});

describe("holm, on random inputs", () => {
  const rng = mulberry32(20261119);
  const randomPs = () => Array.from({ length: 1 + Math.floor(rng() * 12) }, () => (rng() < 0.3 ? rng() * 0.02 : rng()));

  it("never lowers a p value, never passes 1, and keeps the order of the p values", () => {
    for (let n = 0; n < 500; n++) {
      const p = randomPs();
      const h = holm(p, 0.05);
      p.forEach((v, i) => {
        expect(h.adjusted[i]).toBeGreaterThanOrEqual(v - 1e-15);
        expect(h.adjusted[i]).toBeLessThanOrEqual(1);
      });
      const order = p.map((v, i) => [v, h.adjusted[i]]).sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < order.length; i++) expect(order[i][1]).toBeGreaterThanOrEqual(order[i - 1][1] - 1e-15);
    }
  });

  it("flags everything Bonferroni flags, and nothing Benjamini Hochberg leaves out", () => {
    for (let n = 0; n < 500; n++) {
      const p = randomPs();
      const h = holm(p, 0.05).rejected;
      const bonferroni = p.map((v) => v <= 0.05 / p.length);
      const bh = benjaminiHochberg(p, 0.05).rejected;
      p.forEach((_, i) => {
        if (bonferroni[i]) expect(h[i], `Bonferroni flags ${p[i]}`).toBe(true);
        if (h[i]) expect(bh[i], `Holm flags ${p[i]}`).toBe(true);
      });
    }
  });

  it("keeps the chance of any false flag near or under 5 percent when nothing is real", () => {
    // 4,000 runs of 10 null p values each. Holm controls the familywise error rate at 0.05, so any flag at all should
    // happen in at most about 5 percent of runs. The band allows for simulation error.
    let anyFlag = 0;
    const runs = 4_000;
    for (let n = 0; n < runs; n++) {
      const p = Array.from({ length: 10 }, () => rng());
      if (holm(p, 0.05).rejected.some(Boolean)) anyFlag++;
    }
    const rate = anyFlag / runs;
    console.log(`Holm, 10 null tests: any false flag in ${anyFlag} of ${runs} runs`);
    expect(rate).toBeLessThan(0.06);
    expect(rate).toBeGreaterThan(0.03);
  });
});
