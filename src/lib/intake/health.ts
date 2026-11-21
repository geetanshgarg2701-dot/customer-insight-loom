/**
 * The data health score, plan feature 7: a number from 0 to 100 for a loaded file, and a plain cleaning report.
 *
 * It is worked out from counts only, so it can be checked by hand. It never carries a cell value. A finding names a
 * column, a count and a fix, and a row number may be given so a person can find the row in their own file.
 *
 * What a score cannot do: it measures whether the data is complete, unique, well formed and tidy. It cannot tell whether a
 * value is right. A column of wrong prices that are all valid numbers scores full marks.
 */

export type ColumnKind = "number" | "date" | "text";

export type ColumnHealth = {
  /** The name the column was loaded as. */
  name: string;
  /** Cells that hold any text, placeholders included. Empty cells are not counted. */
  nonNull: number;
  /** Cells that say N/A, null, none or similar. They count as missing, because they carry no value. */
  placeholders: number;
  distinct: number;
  /** What most of the filled cells look like. */
  kind: ColumnKind;
  /** For a number or date column: filled cells that are not a valid number or date. */
  invalid: number;
  /** Cells with spaces at the start or end. */
  strayWhitespace: number;
  /** Row numbers of the first problem cells, counting the first row after the header as row 1. Never values. */
  examples?: number[];
};

export type HealthInput = {
  /** Data rows in the file, whether they loaded or not. */
  rowsInFile: number;
  /** Rows that loaded. */
  rows: number;
  /** Loaded rows that repeat an earlier row exactly. */
  duplicateRows: number;
  columns: ColumnHealth[];
};

export const HEALTH_WEIGHTS = { completeness: 35, uniqueness: 20, validity: 20, tidiness: 10, rowIntegrity: 15 } as const;
type PartId = keyof typeof HEALTH_WEIGHTS;

export type Part = {
  /** What it is out of, before any sharing of weight. */
  weight: number;
  /** Points earned, out of the weight after sharing. */
  points: number;
  /** The share of the best case, 0 to 1. */
  share: number;
  scored: boolean;
};

export type Severity = "high" | "medium" | "low" | "info";
export type Finding = {
  id: string;
  severity: Severity;
  column: string | null;
  count: number;
  text: string;
  fix: string;
  examples?: number[];
};

export type Band = "good" | "fair" | "poor";
export type HealthReport = {
  score: number;
  band: Band;
  parts: Record<PartId, Part>;
  findings: Finding[];
  caveat: string;
  rows: number;
  columns: number;
};

export const HEALTH_CAVEAT =
  "The score cannot tell whether a value is right, only whether the file is complete, unique, well formed and tidy. " +
  "A column of wrong prices that are all valid numbers scores full marks.";

export function bandOf(score: number): Band {
  return score >= 90 ? "good" : score >= 75 ? "fair" : "poor";
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export function scoreHealth(input: HealthInput): HealthReport {
  const { rows, rowsInFile, duplicateRows, columns } = input;
  const cells = rows * columns.length;
  const filled = columns.reduce((n, c) => n + (c.nonNull - c.placeholders), 0);
  const missing = columns.reduce((n, c) => n + (rows - c.nonNull) + c.placeholders, 0);
  const typed = columns.filter((c) => c.kind !== "text");
  const typedFilled = typed.reduce((n, c) => n + (c.nonNull - c.placeholders), 0);
  const typedInvalid = typed.reduce((n, c) => n + c.invalid, 0);
  const stray = columns.reduce((n, c) => n + c.strayWhitespace, 0);

  const shares: Record<PartId, { share: number; scored: boolean }> = {
    completeness: { share: cells === 0 ? 0 : clamp01(1 - missing / cells), scored: true },
    uniqueness: { share: rows === 0 ? 0 : clamp01(1 - duplicateRows / rows), scored: true },
    validity: { share: typedFilled === 0 ? 1 : clamp01(1 - typedInvalid / typedFilled), scored: typed.length > 0 && typedFilled > 0 },
    tidiness: { share: filled === 0 ? 1 : clamp01(1 - stray / filled), scored: true },
    rowIntegrity: { share: rowsInFile === 0 ? 0 : clamp01(rows / rowsInFile), scored: true },
  };
  // With no number or date column there is nothing to check for validity. Its weight goes to the other parts in
  // proportion to theirs, so a clean file still scores 100 and no part is given marks it did not earn.
  const total = (Object.keys(HEALTH_WEIGHTS) as PartId[]).reduce((n, id) => n + (shares[id].scored ? HEALTH_WEIGHTS[id] : 0), 0);
  const parts = {} as Record<PartId, Part>;
  let score = 0;
  for (const id of Object.keys(HEALTH_WEIGHTS) as PartId[]) {
    const scored = shares[id].scored;
    const points = scored ? (HEALTH_WEIGHTS[id] / total) * 100 * shares[id].share : 0;
    parts[id] = { weight: HEALTH_WEIGHTS[id], points, share: shares[id].share, scored };
    score += points;
  }
  const rounded = rows === 0 ? 0 : Math.round(score);

  return {
    score: rounded,
    band: bandOf(rounded),
    parts,
    findings: findingsFor(input),
    caveat: HEALTH_CAVEAT,
    rows,
    columns: columns.length,
  };
}

const ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };

function findingsFor(input: HealthInput): Finding[] {
  const { rows, rowsInFile, duplicateRows, columns } = input;
  const out: Finding[] = [];
  if (rows === 0) {
    out.push({
      id: "no-rows",
      severity: "high",
      column: null,
      count: 0,
      text: "No row could be loaded.",
      fix: "Check that the file has a header row, comma separators and at least one data row, then load it again.",
    });
    return out;
  }
  if (rowsInFile > rows) {
    const n = rowsInFile - rows;
    out.push({
      id: "skipped-rows",
      severity: n / rowsInFile >= 0.01 ? "high" : "medium",
      column: null,
      count: n,
      text: `${plural(n, "row was", "rows were")} skipped because ${n === 1 ? "it" : "they"} had too few or too many fields.`,
      fix: "Open the file and look at the rows named in the result above. A comma inside a value that is not in quotes is the usual cause.",
    });
  }
  if (duplicateRows > 0) {
    out.push({
      id: "duplicate-rows",
      severity: duplicateRows / rows >= 0.05 ? "high" : "medium",
      column: null,
      count: duplicateRows,
      text: `${plural(duplicateRows, "row repeats", "rows repeat")} an earlier row exactly.`,
      fix: "Remove the repeated rows in your spreadsheet before loading, unless the same event really did happen twice.",
    });
  }
  for (const c of columns) {
    const empty = rows - c.nonNull + c.placeholders;
    if (c.nonNull - c.placeholders === 0) {
      out.push({
        id: "empty-column",
        severity: "high",
        column: c.name,
        count: rows,
        text: `The column "${c.name}" has no value in any row.`,
        fix: "Leave this column out when you map the columns, or fix the export that made it.",
      });
      continue;
    }
    if (empty / rows >= 0.5) {
      out.push({
        id: "mostly-empty",
        severity: "high",
        column: c.name,
        count: empty,
        text: `The column "${c.name}" is empty in ${plural(empty, "row", "rows")}, ${Math.round((empty / rows) * 100)} percent.`,
        fix: "Check whether the export left this field out. A column that is mostly empty is rarely useful for a test.",
      });
    }
    if (c.placeholders > 0) {
      out.push({
        id: "placeholders",
        severity: c.placeholders / rows >= 0.05 ? "medium" : "low",
        column: c.name,
        count: c.placeholders,
        text: `The column "${c.name}" has ${plural(c.placeholders, "cell", "cells")} that say N/A, null, none or similar instead of being empty.`,
        fix: "Replace those words with an empty cell. Until then they look like real values to anything that reads the file.",
      });
    }
    if (c.invalid > 0 && c.kind !== "text") {
      const what = c.kind === "number" ? "number" : "date";
      out.push({
        id: c.kind === "number" ? "invalid-numbers" : "invalid-dates",
        severity: c.invalid / Math.max(1, c.nonNull - c.placeholders) >= 0.05 ? "high" : "medium",
        column: c.name,
        count: c.invalid,
        text: `The column "${c.name}" mostly holds ${what}s, but ${plural(c.invalid, "cell is", "cells are")} not ${what === "number" ? "a number" : "a valid date"}.`,
        fix:
          c.kind === "number"
            ? "Look for currency signs, thousands separators, letters or a stray word in those cells, and fix them to plain numbers."
            : "Dates should read year-month-day, such as 2026-07-04. Check for a day or month that does not exist.",
        ...(c.examples && c.examples.length > 0 ? { examples: c.examples } : {}),
      });
    }
    if (c.strayWhitespace > 0) {
      out.push({
        id: "stray-spaces",
        severity: c.strayWhitespace / rows >= 0.05 ? "medium" : "low",
        column: c.name,
        count: c.strayWhitespace,
        text: `The column "${c.name}" has ${plural(c.strayWhitespace, "cell", "cells")} with a space at the start or end.`,
        fix: "Trim the spaces. Two values that differ only by a space are counted as different.",
      });
    }
    if (c.distinct === 1 && c.nonNull - c.placeholders > 1) {
      out.push({
        id: "constant-column",
        severity: "info",
        column: c.name,
        count: c.nonNull,
        text: `Every filled cell in the column "${c.name}" holds the same value.`,
        fix: "This does not cost points, but a column that never changes tells you nothing and can be left out.",
      });
    }
  }
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || b.count - a.count);
}
