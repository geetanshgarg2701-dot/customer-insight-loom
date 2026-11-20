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

/**
 * The assistant's measured numbers, quoted by the screen and recomputed by assistant-eval.test.ts. Measured on 2026-11-20
 * on a third held out set of 57 questions, written after two earlier rounds. Round 1, the model alone on 54 questions:
 * 31 handled right and complaint right on 11 of 29. Round 2, with more examples, on 55 fresh questions: 33 right and
 * complaint right on 14 of 29. Round 3, the keyword cues with the model as a check, below. Each earlier set moved into
 * the tuning data once its misses had been seen, so only the last round is a fair measure.
 */
export const MEASURED_ASSISTANT = {
  cuts: { guard: 0.38, fallback: 0.96, painThreshold: 0.409 },
  heldOut: { n: 57, typeRight: 49, wrongAnswers: 4, overRefused: 1, painRight: 26, painNeeded: 31, trapsRefused: 12, trapsTotal: 14 },
} as const;
