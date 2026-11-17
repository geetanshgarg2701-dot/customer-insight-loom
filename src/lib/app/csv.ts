import { FORMULA_START } from "../assignment/hash";

/**
 * One cell of a CSV file. A value that starts like a spreadsheet formula gets a quote in front, so opening the file in a
 * spreadsheet cannot run it, and a value with a comma, a quote or a line break is quoted. Used for every file the app
 * writes, because a title or a hypothesis is text a person typed.
 */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** One line of a CSV file, with the Windows line ending spreadsheets expect. */
export function csvLine(cells: readonly string[]): string {
  return cells.map(csvCell).join(",") + "\r\n";
}
