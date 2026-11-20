/**
 * Measures theme coding against a person's labels. Nothing here trains anything. It counts.
 *
 * Accuracy is right answers over all comments, so an uncertain answer counts against it. Accuracy when answered leaves
 * the uncertain ones out, and coverage says how many were answered, so neither number can hide the other.
 */
import type { Pain } from "../insights/comments";
import type { Coded } from "./coder";
import { THEME_ORDER } from "./coder";

export type EvalRow = { text: string; expected: Pain; got: Pain | null; score: number; quote: string | null };
export type EvalResult = {
  n: number;
  answered: number;
  correct: number;
  wrong: number;
  uncertain: number;
  accuracy: number;
  coverage: number;
  accuracyWhenAnswered: number;
  /** What always guessing the most common label would score, the bar to beat. */
  baseline: number;
  perTheme: { theme: Pain; n: number; correct: number; predicted: number; recall: number; precision: number }[];
  rows: EvalRow[];
};

export function scoreCoding(set: readonly { text: string; theme: Pain }[], coded: readonly Coded[]): EvalResult {
  if (set.length !== coded.length || set.length === 0) throw new RangeError("Every comment needs exactly one coding.");
  const rows: EvalRow[] = set.map((s, i) => ({ text: s.text, expected: s.theme, got: coded[i].theme, score: coded[i].score, quote: coded[i].quote?.text ?? null }));
  const answered = rows.filter((r) => r.got !== null).length;
  const correct = rows.filter((r) => r.got === r.expected).length;
  const counts = THEME_ORDER.map((t) => rows.filter((r) => r.expected === t).length);
  const perTheme = THEME_ORDER.map((theme, i) => {
    const predicted = rows.filter((r) => r.got === theme).length;
    const hit = rows.filter((r) => r.got === theme && r.expected === theme).length;
    return { theme, n: counts[i], correct: hit, predicted, recall: counts[i] ? hit / counts[i] : 0, precision: predicted ? hit / predicted : 0 };
  });
  return {
    n: rows.length,
    answered,
    correct,
    wrong: answered - correct,
    uncertain: rows.length - answered,
    accuracy: correct / rows.length,
    coverage: answered / rows.length,
    accuracyWhenAnswered: answered ? correct / answered : 0,
    baseline: Math.max(...counts) / rows.length,
    perTheme,
    rows,
  };
}

/**
 * The similarity below which the coder says uncertain, chosen on the tuning set only: the cut that maximizes right
 * answers minus wrong answers, so a wrong theme costs as much as a right one gains. A tie goes to the lower cut, which
 * answers more. Each candidate is a score seen on the tuning set, nudged just below it, so that comment is answered.
 */
export function chooseThreshold(tune: readonly { score: number; right: boolean }[]): number {
  if (tune.length === 0) throw new RangeError("The tuning set is empty.");
  const candidates = [...new Set(tune.map((t) => t.score))].sort((a, b) => a - b).map((s) => s - 1e-9);
  let bestCut = candidates[0];
  let bestValue = -Infinity;
  for (const cut of candidates) {
    const value = tune.reduce((v, t) => (t.score >= cut ? v + (t.right ? 1 : -1) : v), 0);
    if (value > bestValue) {
      bestValue = value;
      bestCut = cut;
    }
  }
  return bestCut;
}
