import { describe, expect, it } from "vitest";
import { binomialSample, mulberry32 } from "./honesty";
import { readout } from "./readout";

/**
 * How often do the two calls disagree: "significant" from the Newcombe interval excluding zero, and the pooled two
 * proportion z test p value below 0.05? The app and the knowledge file say they disagree only at very small counts.
 *
 * Design, fixed before the first run on 2026-11-18:
 * - Sizes per arm 20, 50, 100, 200, 500, 1000, 2000 and 5000, equal arms.
 * - Control rates 2, 10 and 30 percent.
 * - Two true effects. Null: no difference. Edge: a lift whose expected z is 1.96, where the calls are most likely to
 *   split, so this is close to the worst case for a test of that size.
 * - 10,000 seeded runs per setting.
 *
 * Prediction, written before the run: disagreement shrinks as size grows, and is not zero at large sizes in the edge
 * setting. Decision rule, a judgment: if any setting with 500 or more per arm disagrees more than 1 percent of the time,
 * the sentence "only at very small counts" does not hold and is corrected.
 */

const SIZES = [20, 50, 100, 200, 500, 1000, 2000, 5000] as const;
const RATES = [0.02, 0.1, 0.3] as const;
const RUNS = 10_000;

type Cell = {
  n: number;
  rate: number;
  effect: "null" | "edge";
  runs: number;
  disagree: number;
  intervalOnly: number;
  pOnly: number;
};

function measure(rng: () => number, n: number, rate: number, effect: "null" | "edge"): Cell {
  const lift = effect === "null" ? 0 : 1.96 * Math.sqrt((2 * rate * (1 - rate)) / n);
  const treated = rate + lift;
  let disagree = 0;
  let intervalOnly = 0;
  let pOnly = 0;
  for (let i = 0; i < RUNS; i++) {
    const t = binomialSample(rng, n, treated);
    const c = binomialSample(rng, n, rate);
    const r = readout({ treatment: { n, conversions: t }, control: { n, conversions: c } });
    const byP = r.pValue < 0.05;
    if (r.significant !== byP) {
      disagree++;
      if (r.significant) intervalOnly++;
      else pOnly++;
    }
  }
  return { n, rate, effect, runs: RUNS, disagree, intervalOnly, pOnly };
}

describe("agreement of the interval call and the p value, across sample sizes", () => {
  it(
    "measures disagreement in every setting and checks the predicted shrink with size",
    () => {
      const rng = mulberry32(20261118);
      const cells: Cell[] = [];
      for (const effect of ["null", "edge"] as const) {
        for (const rate of RATES) {
          for (const n of SIZES) cells.push(measure(rng, n, rate, effect));
        }
      }

      const lines = cells.map(
        (c) =>
          `${c.effect.padEnd(4)} rate ${String(c.rate).padEnd(4)} n ${String(c.n).padStart(4)}: ` +
          `${c.disagree} of ${c.runs} disagree, interval only ${c.intervalOnly}, p value only ${c.pOnly}`,
      );
      console.log(`AGREEMENT RESULTS\n${lines.join("\n")}`);

      for (const c of cells) {
        expect(c.disagree).toBe(c.intervalOnly + c.pOnly);
      }
      // The prediction: for each rate and effect, the largest size disagrees no more often than the smallest.
      for (const effect of ["null", "edge"] as const) {
        for (const rate of RATES) {
          const small = cells.find((c) => c.effect === effect && c.rate === rate && c.n === SIZES[0])!;
          const large = cells.find((c) => c.effect === effect && c.rate === rate && c.n === SIZES[SIZES.length - 1])!;
          expect(large.disagree, `${effect} at rate ${rate}`).toBeLessThanOrEqual(small.disagree);
        }
      }
    },
    120_000,
  );
});
