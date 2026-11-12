export type PlainValue = string | number | boolean | null;
export type PlainRow = Record<string, PlainValue>;

/**
 * DuckDB returns integers as bigint. Convert to number when exact,
 * otherwise keep the exact digits as a string so nothing is rounded silently.
 */
export function toPlainValue(value: unknown): PlainValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : value.toString();
  }
  if (
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return String(value);
}

export function toPlainRow(row: Record<string, unknown>): PlainRow {
  const out: PlainRow = {};
  for (const [key, value] of Object.entries(row)) out[key] = toPlainValue(value);
  return out;
}
