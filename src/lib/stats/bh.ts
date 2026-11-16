import { STATS_ENGINE_VERSION } from "./version";

export type BhResult = {
  /** Adjusted p values, in the input order. */
  adjusted: number[];
  /** True where the comparison is a discovery at false discovery rate q. */
  rejected: boolean[];
  /** Shown on any view that compares more than one group, plan section 6.3. */
  comparisons: number;
  q: number;
  method: string;
  engineVersion: string;
};

/** Benjamini Hochberg step up procedure, controlling the false discovery rate at q. */
export function benjaminiHochberg(pValues: readonly number[], q = 0.05): BhResult {
  if (!(q > 0 && q < 1)) throw new RangeError("q must be strictly between 0 and 1.");
  for (const p of pValues) {
    if (!(p >= 0 && p <= 1)) throw new RangeError("Every p value must be between 0 and 1.");
  }
  const m = pValues.length;
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const adjusted = new Array<number>(m);
  let running = 1;
  for (let rank = m; rank >= 1; rank--) {
    const { p, i } = order[rank - 1];
    running = Math.min(running, (p * m) / rank);
    adjusted[i] = running;
  }
  return {
    adjusted,
    rejected: adjusted.map((a) => a <= q),
    comparisons: m,
    q,
    method:
      `Benjamini Hochberg step up procedure across ${m} comparisons, false discovery rate ${q}. ` +
      `Comparisons not registered before launch stay labeled exploratory whatever their adjusted value.`,
    engineVersion: STATS_ENGINE_VERSION,
  };
}
