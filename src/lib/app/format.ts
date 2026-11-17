const NOT_AVAILABLE = "not available";

/** A whole number of people with thousands separators, the same everywhere a count is shown. */
export function formatCount(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString("en-US") : NOT_AVAILABLE;
}

/** A proportion as a percent, for example 0.1235 becomes 12.35 percent. */
export function formatPercent(proportion: number, digits = 2): string {
  if (!Number.isFinite(proportion)) return NOT_AVAILABLE;
  return `${(proportion * 100).toFixed(digits)} percent`;
}

/** A difference of proportions as percentage points. */
export function formatPoints(difference: number, digits = 2): string {
  if (!Number.isFinite(difference)) return NOT_AVAILABLE;
  return `${(difference * 100).toFixed(digits)} points`;
}

/** Like formatPoints with an explicit sign, and no minus sign on a value that rounds to zero. */
export function formatSignedPoints(difference: number, digits = 2): string {
  if (!Number.isFinite(difference)) return NOT_AVAILABLE;
  const scaled = Number((difference * 100).toFixed(digits));
  if (scaled === 0) return `${(0).toFixed(digits)} points`;
  return `${scaled > 0 ? "+" : "-"}${Math.abs(scaled).toFixed(digits)} points`;
}
