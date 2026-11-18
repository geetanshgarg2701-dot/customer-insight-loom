import type { CorrectionMethod } from "./ledger";

/**
 * What the ledger says about multiple comparison correction, kept in one place so the screen, the demo and the
 * exports cannot drift apart. A readout is one treatment group against one control group on one registered metric,
 * so it is a single comparison and there is nothing to correct. The label must say what the code did. It used to
 * say benjamini_hochberg while benjaminiHochberg in stats/bh.ts was called nowhere.
 */

/** The label to store for a result. An entry registered after launch is exploratory, whatever else is true. */
export function correctionFor(
  entryType: "confirmatory" | "exploratory" | null,
  comparisons: number,
): CorrectionMethod {
  if (!Number.isInteger(comparisons) || comparisons < 1) {
    throw new RangeError("A readout makes at least one comparison, counted in whole numbers.");
  }
  if (entryType === "exploratory") return "exploratory_label";
  if (comparisons > 1) {
    // No screen compares several groups yet. A screen that does must call benjaminiHochberg across them and store
    // its own label, so a label can never claim a procedure that did not run.
    throw new RangeError(
      "More than one comparison needs a correction run across all of them. Call benjaminiHochberg and record that.",
    );
  }
  return "not_applied";
}

const comparisonsWord = (n: number) => `${n} ${n === 1 ? "comparison" : "comparisons"}`;

/** The sentence shown with a result, in plain words. */
export function correctionLine(method: CorrectionMethod | null, comparisons: number | null): string {
  if (method === null || comparisons === null) return "No correction label was recorded.";
  const made = `Comparisons made: ${comparisons}.`;
  switch (method) {
    case "not_applied":
      return comparisons === 1
        ? `${made} No multiple comparison correction applies, because one comparison has nothing to correct.`
        : `${made} No multiple comparison correction was applied across them.`;
    case "exploratory_label":
      return `${made} This entry was registered after launch, so the result is labeled exploratory and is not corrected.`;
    case "benjamini_hochberg":
      if (comparisons < 2) {
        // Results saved before this change carry this label with a count of 1. The procedure never ran then.
        return `${made} Recorded as benjamini hochberg, but only ${comparisonsWord(comparisons)} was made, so no correction ran and nothing changed.`;
      }
      return (
        `${made} The Benjamini Hochberg step up procedure was applied across them. It assumes the tests are ` +
        `independent or positively dependent, which overlapping groups may break.`
      );
  }
}

/** A short form for a table cell. */
export function correctionShort(method: CorrectionMethod, comparisons: number): string {
  switch (method) {
    case "not_applied":
      return `Not applied, ${comparisonsWord(comparisons)}`;
    case "exploratory_label":
      return `Exploratory, not corrected, ${comparisonsWord(comparisons)}`;
    case "benjamini_hochberg":
      return comparisons < 2
        ? `Old label, no correction ran, ${comparisonsWord(comparisons)}`
        : `Benjamini Hochberg across ${comparisonsWord(comparisons)}`;
  }
}
