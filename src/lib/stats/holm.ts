import { STATS_ENGINE_VERSION } from "./version";

export type HolmResult = {
  /** Adjusted p values, in the input order. */
  adjusted: number[];
  /** True where the comparison is flagged at the familywise level alpha. */
  rejected: boolean[];
  comparisons: number;
  alpha: number;
  method: string;
  engineVersion: string;
};

/**
 * Holm step down procedure, controlling the chance of any false flag across the family at alpha. The plan uses it for
 * fewer than 10 comparisons, where it is safer than Benjamini Hochberg and the power lost is small. It is valid for any
 * dependence between the tests.
 */
export function holm(pValues: readonly number[], alpha = 0.05): HolmResult {
  if (!(alpha > 0 && alpha < 1)) throw new RangeError("alpha must be strictly between 0 and 1.");
  for (const p of pValues) {
    if (!(p >= 0 && p <= 1)) throw new RangeError("Every p value must be between 0 and 1.");
  }
  const m = pValues.length;
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const adjusted = new Array<number>(m);
  let running = 0;
  order.forEach(({ p, i }, rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * p));
    adjusted[i] = running;
  });
  return {
    adjusted,
    rejected: adjusted.map((a) => a <= alpha),
    comparisons: m,
    alpha,
    method:
      `Holm step down procedure across ${m} ${m === 1 ? "comparison" : "comparisons"}, keeping the chance of any false ` +
      `flag in the family at ${alpha}.`,
    engineVersion: STATS_ENGINE_VERSION,
  };
}
