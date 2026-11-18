import { describe, expect, it } from "vitest";
import { benjaminiHochberg } from "./bh";
import { normalCdf } from "./distributions";
import { mulberry32 } from "./honesty";

/**
 * Benjamini Hochberg on a mix of real and null effects. This only tests the procedure. It is not wired into any screen,
 * because no screen compares several groups yet.
 */

describe("Benjamini Hochberg changes what is flagged, hand checked", () => {
  it("flags two of five where a plain p below 0.05 flags four", () => {
    // Worked by hand at q 0.05 with 5 comparisons. Sorted p values with their thresholds k times q over m:
    // 0.010 against 0.01 passes, 0.020 against 0.02 passes, 0.035 against 0.03 fails, 0.045 against 0.04 fails,
    // 0.300 against 0.05 fails. The largest passing rank is 2, so the first two are discoveries.
    // Adjusted values, stepping down from the largest: 0.3, then 0.045 times 5 over 4 is 0.05625, then 0.035 times 5
    // over 3 is 0.0583 so it takes the smaller 0.05625, then 0.02 times 5 over 2 is 0.05, then 0.01 times 5 is 0.05.
    const p = [0.01, 0.02, 0.035, 0.045, 0.3];
    const plain = p.map((v) => v < 0.05);
    const r = benjaminiHochberg(p, 0.05);
    expect(plain).toEqual([true, true, true, true, false]);
    expect(r.rejected).toEqual([true, true, false, false, false]);
    [0.05, 0.05, 0.05625, 0.05625, 0.3].forEach((v, i) => expect(r.adjusted[i], `p ${p[i]}`).toBeCloseTo(v, 12));
    expect(r.comparisons).toBe(5);
  });
});

/** Two sided p value of a z score. */
const twoSided = (z: number) => Math.min(1, 2 * normalCdf(-Math.abs(z)));

/** Standard normal draws by the Box Muller method, from the seeded generator. */
function normal(rng: () => number): number {
  const u = Math.max(rng(), Number.MIN_VALUE);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

describe("Benjamini Hochberg on simulated real and null effects", () => {
  /*
   * Design and expectations, written before the first run on 2026-11-18:
   * - 40 independent tests per run. A share of them are real, with z centered at 3. The rest are null, with z centered
   *   at 0. Shares of real effects: 10, 25 and 50 percent. 4,000 seeded runs each, at q 0.05.
   * - Expectation 1, from theory: for independent tests the false discovery rate of the procedure equals the null share
   *   times q. The mean false discovery proportion must be within 3 standard errors of that.
   * - Expectation 2: it finds more of the real effects than Bonferroni, which flags p at or below q over 40.
   * - Expectation 3: a plain p below 0.05 with no correction has a higher false discovery proportion than the procedure.
   */
  const M = 40;
  const RUNS = 4_000;
  const Q = 0.05;

  for (const realShare of [0.1, 0.25, 0.5]) {
    it(`keeps false discoveries near the null share times q with ${realShare * 100} percent real effects`, () => {
      const rng = mulberry32(20261118 + Math.round(realShare * 1000));
      const real = Math.round(M * realShare);
      const nullShare = (M - real) / M;
      const fdp: number[] = [];
      let bhTrue = 0;
      let bonferroniTrue = 0;
      let plainFdpSum = 0;
      for (let run = 0; run < RUNS; run++) {
        const isReal = Array.from({ length: M }, (_, i) => i < real);
        const p = isReal.map((r) => twoSided(normal(rng) + (r ? 3 : 0)));
        const flagged = benjaminiHochberg(p, Q).rejected;
        const count = flagged.filter(Boolean).length;
        const falseOnes = flagged.filter((f, i) => f && !isReal[i]).length;
        fdp.push(count === 0 ? 0 : falseOnes / count);
        bhTrue += flagged.filter((f, i) => f && isReal[i]).length;
        bonferroniTrue += p.filter((v, i) => v <= Q / M && isReal[i]).length;
        const plain = p.map((v) => v < Q);
        const plainCount = plain.filter(Boolean).length;
        const plainFalse = plain.filter((f, i) => f && !isReal[i]).length;
        plainFdpSum += plainCount === 0 ? 0 : plainFalse / plainCount;
      }
      const mean = fdp.reduce((a, b) => a + b, 0) / RUNS;
      const sd = Math.sqrt(fdp.reduce((a, b) => a + (b - mean) ** 2, 0) / (RUNS - 1));
      const se = sd / Math.sqrt(RUNS);
      const target = nullShare * Q;
      const plainMean = plainFdpSum / RUNS;
      console.log(
        `BH MIXED real ${real} of ${M}: false discovery rate ${mean.toFixed(4)} against ${target.toFixed(4)}, ` +
          `standard error ${se.toFixed(4)}, real effects found per run ${(bhTrue / RUNS).toFixed(2)} by the procedure ` +
          `and ${(bonferroniTrue / RUNS).toFixed(2)} by Bonferroni, plain p below 0.05 false discovery rate ${plainMean.toFixed(4)}`,
      );
      expect(Math.abs(mean - target), "expectation 1").toBeLessThanOrEqual(3 * se);
      expect(bhTrue, "expectation 2").toBeGreaterThan(bonferroniTrue);
      expect(plainMean, "expectation 3").toBeGreaterThan(mean);
    }, 60_000);
  }
});
