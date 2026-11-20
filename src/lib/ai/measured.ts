/**
 * What the evaluation measured, quoted by the screen. eval.test.ts recomputes these and fails if they ever differ, so
 * the screen cannot claim a number the test does not see. Measured on 2026-11-20 in Node.
 */
export const MEASURED = {
  /** The similarity below which the coder says uncertain, chosen on the 21 tuning comments only. */
  threshold: 0.246,
  heldOut: { n: 56, correct: 49, wrong: 5, uncertain: 2 },
  generator: { n: 251, correct: 205 },
} as const;
