type Counted = { entryType: "confirmatory" | "exploratory" | null; result: unknown; synthetic: boolean };

/**
 * The confirmatory label controls the error rate of one test, not of a whole list. Twenty near duplicate
 * hypotheses with no real effect give a 64 percent chance that at least one reads significant. This line says so
 * on the ledger screen. It counts confirmatory entries with a recorded result, and leaves out demo entries.
 */
export function familywiseLine(
  entries: readonly Counted[],
  alpha = 0.05,
): { tests: number; chanceAtLeastOne: number; text: string } | null {
  const tests = entries.filter((e) => e.entryType === "confirmatory" && e.result !== null && !e.synthetic).length;
  if (tests < 2) return null;
  const chanceAtLeastOne = 1 - (1 - alpha) ** tests;
  const expected = Number((tests * alpha).toFixed(1));
  const falsePositives = `${expected} false ${expected === 1 ? "positive" : "positives"}`;
  return {
    tests,
    chanceAtLeastOne,
    text:
      `${tests} confirmatory tests have a recorded result, each at ${alpha * 100} percent. ` +
      `If none of them had a real effect, about ${falsePositives} would be expected, and the chance that at least one ` +
      `reads significant is ${(chanceAtLeastOne * 100).toFixed(1)} percent. Each test is still valid on its own. ` +
      `This line is about the whole list.`,
  };
}
