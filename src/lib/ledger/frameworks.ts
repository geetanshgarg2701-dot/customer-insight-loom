import { holm } from "../stats/holm";
import { studentTCdf, studentTQuantile } from "../stats/distributions";
import { FRAMEWORK_TAGS, type FrameworkTag } from "./ledger";

/**
 * Compares email frameworks, PAS, FAB and AIDA, across ledger entries, plan section 6.5.
 *
 * The unit is one test. Each test's effect is the log of its treatment rate over its control rate, so tests with
 * different baseline rates sit on one scale. Tests within a framework are pooled with a random effects model, because
 * tests differ in audience, offer and season, so their true effects differ too. The spread between tests is estimated
 * by DerSimonian and Laird, and the interval uses the modified Hartung Knapp method: a t quantile with tests minus one
 * degrees of freedom, and an error never smaller than the plain random effects one. The plain normal interval is too
 * narrow when there are only a few tests. Frameworks are compared in pairs, and the pairs are corrected with Holm, as
 * on the compare screen.
 *
 * What this cannot show: the tests were not assigned a framework at random, so a framework that did better may simply
 * have been used for better offers or easier audiences. It is an association across tests, never proof that the
 * framework made the difference.
 */

export const MIN_ARM = 30;
export const MIN_TESTS = 5;
export const ALPHA = 0.05;

export type FrameworkInput = {
  id: string;
  title: string;
  frameworkTag: FrameworkTag | null;
  result: unknown;
  synthetic: boolean;
};

type Bag = Record<string, unknown>;
const isBag = (v: unknown): v is Bag => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

export type Effect = { y: number; v: number };

/** Counts from a recorded result, or null when it lacks them. */
function countsOf(r: unknown): { xT: number; nT: number; xC: number; nC: number } | null {
  if (!isBag(r) || !isBag(r.sample_sizes)) return null;
  const nT = r.sample_sizes.treatment;
  const nC = r.sample_sizes.control;
  const pT = r.treatment_rate;
  const pC = r.control_rate;
  if (!count(nT) || !count(nC) || nT === 0 || nC === 0) return null;
  if (typeof pT !== "number" || typeof pC !== "number" || !(pT >= 0 && pT <= 1 && pC >= 0 && pC <= 1)) return null;
  return { xT: Math.round(pT * nT), nT, xC: Math.round(pC * nC), nC };
}

/**
 * The log risk ratio of one test and its variance. When an arm has no conversions, or all, a half is added to every
 * cell so the log is finite. Null when the result lacks counts, or neither arm converted, which carries no ratio.
 */
export function testEffect(r: unknown): Effect | null {
  const c = countsOf(r);
  if (!c) return null;
  if (c.xT === 0 && c.xC === 0) return null;
  const fix = c.xT === 0 || c.xC === 0 || c.xT === c.nT || c.xC === c.nC ? 0.5 : 0;
  const xT = c.xT + fix;
  const xC = c.xC + fix;
  const nT = c.nT + 2 * fix;
  const nC = c.nC + 2 * fix;
  return { y: Math.log(xT / nT / (xC / nC)), v: 1 / xT - 1 / nT + 1 / xC - 1 / nC };
}

export type Pooled = {
  /** On the log scale. */
  estimate: number;
  se: number;
  low: number;
  high: number;
  df: number;
  /** Variance of the true effects between tests. */
  tau2: number;
  /** Share of the spread between tests that is not chance, from 0 to 1. */
  i2: number;
};

/** Random effects pooling, DerSimonian Laird with the modified Hartung Knapp interval. Needs at least two tests. */
export function pool(effects: readonly Effect[], alpha = ALPHA): Pooled {
  const k = effects.length;
  if (k < 2) throw new RangeError("Pooling needs at least two tests.");
  const w = effects.map((e) => 1 / e.v);
  const sw = w.reduce((a, b) => a + b, 0);
  const fixed = effects.reduce((a, e, i) => a + w[i] * e.y, 0) / sw;
  const q = effects.reduce((a, e, i) => a + w[i] * (e.y - fixed) ** 2, 0);
  const sw2 = w.reduce((a, b) => a + b * b, 0);
  const tau2 = Math.max(0, (q - (k - 1)) / (sw - sw2 / sw));
  const ws = effects.map((e) => 1 / (e.v + tau2));
  const sws = ws.reduce((a, b) => a + b, 0);
  const estimate = effects.reduce((a, e, i) => a + ws[i] * e.y, 0) / sws;
  const plain = Math.sqrt(1 / sws);
  const hk = Math.sqrt(effects.reduce((a, e, i) => a + ws[i] * (e.y - estimate) ** 2, 0) / ((k - 1) * sws));
  const se = Math.max(plain, hk);
  const df = k - 1;
  const t = studentTQuantile(1 - alpha / 2, df);
  return { estimate, se, low: estimate - t * se, high: estimate + t * se, df, tau2, i2: q > k - 1 ? (q - (k - 1)) / q : 0 };
}

export type Group = {
  tag: FrameworkTag;
  tests: number;
  /**
   * Null when there are fewer than MIN_TESTS tests. estimate, se, low and high are on the log scale. relativeLift,
   * liftLow and liftHigh are relative: 0.2 means the treatment rate was 20 percent higher than control.
   */
  pooled: (Pooled & { relativeLift: number; liftLow: number; liftHigh: number }) | null;
};

export type Pair = {
  a: FrameworkTag;
  b: FrameworkTag;
  /** Relative: the ratio of a's pooled ratio to b's, minus one. Positive means a did better. */
  difference: number;
  low: number;
  high: number;
  p: number;
  adjusted: number;
  flagged: boolean;
  comparisons: number;
};

export type Excluded = { synthetic: number; noTag: number; noResult: number; noCounts: number; smallArm: number };

export type FrameworkComparison = { groups: Group[]; pairs: Pair[]; excluded: Excluded; text: string; method: string };

export const FRAMEWORK_METHOD =
  "Each test's effect is the log of its treatment rate over its control rate. Tests in one framework are pooled with a " +
  "random effects model, DerSimonian and Laird, and the 95 percent interval uses the modified Hartung Knapp method with " +
  "a t quantile. Frameworks are compared in pairs, and the pairs are corrected with Holm. A test needs at least " +
  `${MIN_ARM} customers in each arm, and a framework needs at least ${MIN_TESTS} tests to be shown. Demo entries are left out.`;

export function compareFrameworks(entries: readonly FrameworkInput[], alpha = ALPHA): FrameworkComparison {
  const excluded: Excluded = { synthetic: 0, noTag: 0, noResult: 0, noCounts: 0, smallArm: 0 };
  const byTag = new Map<FrameworkTag, Effect[]>(FRAMEWORK_TAGS.map((t) => [t, []]));
  for (const e of entries) {
    if (e.synthetic) excluded.synthetic++;
    else if (e.frameworkTag === null) excluded.noTag++;
    else if (e.result === null || e.result === undefined) excluded.noResult++;
    else {
      const c = countsOf(e.result);
      const eff = testEffect(e.result);
      if (!c || !eff) excluded.noCounts++;
      else if (c.nT < MIN_ARM || c.nC < MIN_ARM) excluded.smallArm++;
      else byTag.get(e.frameworkTag)!.push(eff);
    }
  }

  const groups: Group[] = FRAMEWORK_TAGS.map((tag) => {
    const effects = byTag.get(tag)!;
    if (effects.length < MIN_TESTS) return { tag, tests: effects.length, pooled: null };
    const p = pool(effects, alpha);
    return {
      tag,
      tests: effects.length,
      pooled: { ...p, relativeLift: Math.exp(p.estimate) - 1, liftLow: Math.exp(p.low) - 1, liftHigh: Math.exp(p.high) - 1 },
    };
  });

  const shown = groups.filter((g) => g.pooled !== null);
  const raw: Omit<Pair, "adjusted" | "flagged" | "comparisons">[] = [];
  for (let i = 0; i < shown.length; i++) {
    for (let j = i + 1; j < shown.length; j++) {
      const a = shown[i].pooled!;
      const b = shown[j].pooled!;
      const d = a.estimate - b.estimate;
      const se = Math.sqrt(a.se ** 2 + b.se ** 2);
      const df = Math.min(a.df, b.df);
      const t = studentTQuantile(1 - alpha / 2, df);
      raw.push({
        a: shown[i].tag,
        b: shown[j].tag,
        difference: Math.exp(d) - 1,
        low: Math.exp(d - t * se) - 1,
        high: Math.exp(d + t * se) - 1,
        p: Math.min(1, 2 * (1 - studentTCdf(Math.abs(d) / se, df))),
      });
    }
  }
  const h = raw.length > 0 ? holm(raw.map((r) => r.p), alpha) : null;
  const pairs: Pair[] = raw.map((r, i) => ({ ...r, adjusted: h!.adjusted[i], flagged: h!.rejected[i], comparisons: raw.length }));

  return { groups, pairs, excluded, text: summary(groups, pairs), method: FRAMEWORK_METHOD };
}

const pct = (x: number) => `${(x * 100).toFixed(1)} percent`;

function summary(groups: readonly Group[], pairs: readonly Pair[]): string {
  const caveat =
    "This is an association across tests. The tests were not given a framework at random, so a difference here does not " +
    "show that the framework made it, and it is not proof.";
  const shown = groups.filter((g) => g.pooled);
  if (shown.length < 2) {
    return (
      `A framework needs at least ${MIN_TESTS} tests with a result before it is compared. ` +
      groups.map((g) => `${g.tag} has ${g.tests}.`).join(" ") +
      " " +
      caveat
    );
  }
  const flagged = pairs.filter((p) => p.flagged);
  const lead =
    flagged.length === 0
      ? `No pair of frameworks differs after the Holm correction across ${pairs.length} ${pairs.length === 1 ? "comparison" : "comparisons"}.`
      : flagged
          .map((p) => {
            const [hi, lo] = p.difference > 0 ? [p.a, p.b] : [p.b, p.a];
            const size = p.difference > 0 ? p.difference : 1 / (1 + p.difference) - 1;
            return `${hi} tests lifted more than ${lo} tests, by ${pct(size)} relative, after the Holm correction across ${p.comparisons} ${p.comparisons === 1 ? "comparison" : "comparisons"}.`;
          })
          .join(" ");
  return `${lead} ${caveat}`;
}
