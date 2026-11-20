import { describe, expect, it } from "vitest";
import { binomialSample, mulberry32 } from "../stats/honesty";
import { compareFrameworks, MIN_ARM, MIN_TESTS, pool, testEffect, type FrameworkInput } from "./frameworks";

/** A result as the readout records it, from counts. */
function result(xT: number, nT: number, xC: number, nC: number) {
  return { treatment_rate: xT / nT, control_rate: xC / nC, lift: xT / nT - xC / nC, sample_sizes: { treatment: nT, control: nC } };
}

let id = 0;
function entry(tag: FrameworkInput["frameworkTag"], r: unknown, extra: Partial<FrameworkInput> = {}): FrameworkInput {
  return { id: `e${++id}`, title: `Test ${id}`, frameworkTag: tag, result: r, synthetic: false, ...extra };
}

describe("the effect of one test", () => {
  it("is the log of treatment rate over control rate, with the usual variance", () => {
    const e = testEffect(result(120, 1000, 100, 1000))!;
    expect(e.y).toBeCloseTo(Math.log(1.2), 12);
    expect(e.v).toBeCloseTo(1 / 120 - 1 / 1000 + 1 / 100 - 1 / 1000, 12);
  });

  it("adds a half to every cell when an arm has no conversions, so the log is finite", () => {
    const e = testEffect(result(0, 200, 4, 200))!;
    expect(e.y).toBeCloseTo(Math.log(0.5 / 201 / (4.5 / 201)), 12);
    expect(e.v).toBeCloseTo(1 / 0.5 - 1 / 201 + 1 / 4.5 - 1 / 201, 12);
    expect(Number.isFinite(e.y)).toBe(true);
  });

  it("is null when the result lacks counts or both arms are empty of conversions", () => {
    expect(testEffect(null)).toBeNull();
    expect(testEffect({ lift: 0.01 })).toBeNull();
    expect(testEffect(result(0, 100, 0, 100))).toBeNull();
    expect(testEffect({ ...result(5, 100, 5, 100), sample_sizes: { treatment: -1, control: 100 } })).toBeNull();
  });
});

describe("pooling tests", () => {
  it("returns the shared effect, with no spread between tests, when every test agrees", () => {
    const p = pool([
      { y: 0.1, v: 0.01 },
      { y: 0.1, v: 0.02 },
      { y: 0.1, v: 0.04 },
    ]);
    expect(p.estimate).toBeCloseTo(0.1, 12);
    expect(p.tau2).toBe(0);
    expect(p.i2).toBe(0);
  });

  it("matches a case worked by hand", () => {
    // y = 0 and 3, each with variance 1. Fixed weights 1 and 1, mean 1.5, Q = 4.5, so tau squared = (4.5 - 1) / (2 - 1) = 3.5.
    // Random effects weights are 1 / 4.5 each, the estimate stays 1.5, and its standard error is root 2.25 = 1.5. The
    // Hartung Knapp error is the same here: (1/4.5)(2.25 + 2.25) / (1 * 2/4.5) = 2.25. With 1 degree of freedom the
    // interval is 1.5 plus or minus 12.7062 times 1.5.
    const p = pool([
      { y: 0, v: 1 },
      { y: 3, v: 1 },
    ]);
    expect(p.tau2).toBeCloseTo(3.5, 12);
    expect(p.estimate).toBeCloseTo(1.5, 12);
    expect(p.se).toBeCloseTo(1.5, 12);
    expect(p.df).toBe(1);
    expect(p.low).toBeCloseTo(1.5 - 12.706204736 * 1.5, 6);
    expect(p.high).toBeCloseTo(1.5 + 12.706204736 * 1.5, 6);
    expect(p.i2).toBeCloseTo((4.5 - 1) / 4.5, 12);
  });

  it("never reports an error smaller than the plain random effects one, the modified Hartung Knapp rule", () => {
    // Tests that agree more closely than their variances predict make the Hartung Knapp error small. The floor keeps it.
    const p = pool([
      { y: 0.1, v: 0.04 },
      { y: 0.1001, v: 0.04 },
      { y: 0.0999, v: 0.04 },
    ]);
    expect(p.se).toBeCloseTo(Math.sqrt(1 / (3 / 0.04)), 12);
  });
});

describe("comparing frameworks", () => {
  const five = (tag: FrameworkInput["frameworkTag"], xT: number, xC: number) =>
    Array.from({ length: MIN_TESTS }, () => entry(tag, result(xT, 2000, xC, 2000)));

  it("says why each entry was left out, and counts them", () => {
    const out = compareFrameworks([
      entry(null, result(10, 100, 10, 100)),
      entry("PAS", null),
      entry("PAS", result(1, MIN_ARM - 1, 1, 100)),
      entry("PAS", result(10, 100, 10, 100), { synthetic: true }),
      entry("PAS", { lift: 0.02 }),
    ]);
    expect(out.excluded).toEqual({ noTag: 1, noResult: 1, smallArm: 1, synthetic: 1, noCounts: 1 });
    expect(out.groups.every((g) => g.tests === 0)).toBe(true);
  });

  it("gives no estimate for a framework with fewer than the minimum tests, only its count", () => {
    const out = compareFrameworks([...five("PAS", 240, 200), entry("FAB", result(240, 2000, 200, 2000))]);
    const fab = out.groups.find((g) => g.tag === "FAB")!;
    expect(fab.tests).toBe(1);
    expect(fab.pooled).toBeNull();
    expect(out.groups.find((g) => g.tag === "PAS")!.pooled).not.toBeNull();
    expect(out.pairs).toEqual([]);
    expect(out.text).toMatch(/at least 5 tests/);
  });

  it("gives no estimate at one test under the minimum either", () => {
    const four = Array.from({ length: MIN_TESTS - 1 }, () => entry("AIDA", result(240, 2000, 200, 2000)));
    const out = compareFrameworks([...five("PAS", 240, 200), ...four]);
    expect(out.groups.find((g) => g.tag === "AIDA")).toMatchObject({ tests: MIN_TESTS - 1, pooled: null });
  });

  it("flags a pair only when its Holm adjusted p value is under 5 percent, not its raw one", () => {
    // Search the simulated teams for a pair that a raw 5 percent cut would flag and Holm does not.
    let checked = 0;
    for (let s = 1; s <= 400 && checked < 3; s++) {
      const out = compareFrameworks(simulate(9000 + s, 6, { PAS: 0.12, FAB: 0, AIDA: 0.06 }));
      for (const p of out.pairs) {
        expect(p.flagged).toBe(p.adjusted < 0.05);
        if (p.p < 0.05 && p.adjusted >= 0.05) {
          expect(p.flagged).toBe(false);
          checked++;
        }
      }
    }
    expect(checked).toBe(3);
  });

  it("reports the pooled relative lift per framework", () => {
    const out = compareFrameworks(five("PAS", 240, 200));
    const pas = out.groups.find((g) => g.tag === "PAS")!.pooled!;
    expect(pas.relativeLift).toBeCloseTo(0.2, 10);
    expect(pas.liftLow).toBeLessThan(0.2);
    expect(pas.liftHigh).toBeGreaterThan(0.2);
  });

  it("corrects the pairs it compares with Holm, and counts only pairs where both sides are shown", () => {
    const out = compareFrameworks([...five("PAS", 260, 200), ...five("FAB", 200, 200), ...five("AIDA", 202, 200)]);
    expect(out.pairs.map((p) => `${p.a} ${p.b}`)).toEqual(["PAS FAB", "PAS AIDA", "FAB AIDA"]);
    for (const p of out.pairs) expect(p.comparisons).toBe(3);
    const raw = out.pairs.map((p) => p.p);
    const sorted = [...raw].sort((a, b) => a - b);
    const holm = sorted.map((p, k) => Math.min(1, (3 - k) * p));
    for (let k = 1; k < 3; k++) holm[k] = Math.max(holm[k], holm[k - 1]);
    for (const p of out.pairs) expect(p.adjusted).toBeCloseTo(holm[sorted.indexOf(p.p)], 12);
    expect(out.pairs[0].flagged).toBe(true);
    expect(out.pairs[2].flagged).toBe(false);
  });

  it("says it is an association across tests, never a cause", () => {
    const out = compareFrameworks([...five("PAS", 260, 200), ...five("FAB", 200, 200)]);
    expect(out.text).toMatch(/association/i);
    expect(out.text).toMatch(/not proof|does not show/i);
    expect(JSON.stringify(out)).not.toMatch(/\bcauses?\b|\bcaused\b|\bdrives?\b/i);
  });
});

/** Tests with a true relative lift per framework and a random baseline, as a team would run them. */
function simulate(seed: number, perFramework: number, lift: Record<"PAS" | "FAB" | "AIDA", number>): FrameworkInput[] {
  const rng = mulberry32(seed);
  const out: FrameworkInput[] = [];
  for (const tag of ["PAS", "FAB", "AIDA"] as const) {
    for (let i = 0; i < perFramework; i++) {
      const base = 0.03 + rng() * 0.07;
      const n = 3000 + Math.floor(rng() * 4000);
      const xT = binomialSample(rng, n, Math.min(0.99, base * (1 + lift[tag])));
      const xC = binomialSample(rng, n, base);
      out.push(entry(tag, result(xT, n, xC, n)));
    }
  }
  return out;
}

describe("honesty of the comparison, by simulation", () => {
  it("flags any pair in at most about 5 percent of runs when no framework differs", () => {
    let runs = 0;
    let anyFlag = 0;
    for (let s = 1; s <= 400; s++) {
      const out = compareFrameworks(simulate(s, 6, { PAS: 0.1, FAB: 0.1, AIDA: 0.1 }));
      runs++;
      if (out.pairs.some((p) => p.flagged)) anyFlag++;
    }
    // Holm holds the chance of any false flag at 5 percent. With 400 runs, 3 standard errors above 5 percent is 8.3.
    expect(anyFlag / runs).toBeLessThan(0.083);
  });

  it("finds a real difference most of the time when one framework is better", () => {
    let found = 0;
    for (let s = 1; s <= 100; s++) {
      const out = compareFrameworks(simulate(1000 + s, 8, { PAS: 0.3, FAB: 0, AIDA: 0 }));
      const pasFab = out.pairs.find((p) => p.a === "PAS" && p.b === "FAB")!;
      if (pasFab.flagged && pasFab.difference > 0) found++;
    }
    expect(found).toBeGreaterThan(70);
  });

  it("covers the true lift about 95 percent of the time", () => {
    let covered = 0;
    const truth = 0.15;
    for (let s = 1; s <= 300; s++) {
      const out = compareFrameworks(simulate(5000 + s, 6, { PAS: truth, FAB: 0, AIDA: 0 }));
      const pas = out.groups.find((g) => g.tag === "PAS")!.pooled!;
      if (pas.liftLow <= truth && truth <= pas.liftHigh) covered++;
    }
    expect(covered / 300).toBeGreaterThan(0.92);
  });
});
