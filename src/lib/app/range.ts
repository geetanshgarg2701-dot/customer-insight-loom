/**
 * The picture of a result's range: a number line with zero marked, the interval as a bar, and the lift as a marker. All
 * values are fractions, as the readout holds them, and the picture reads them in percentage points.
 */

export type RangeView = {
  /** Axis ends, in percentage points. Symmetric around zero, so the zero line always sits in the middle. */
  min: number;
  max: number;
  ticks: number[];
  /** Position from 0 to 100 along the axis for a value in percentage points. */
  at: (points: number) => number;
  lowPct: number;
  highPct: number;
  liftPct: number;
  zeroPct: number;
  /** The range includes zero, so the result cannot rule out no effect. */
  includesZero: boolean;
  direction: "above" | "below" | "spans";
};

/** A step of 1, 2, 5 times a power of ten, at least as large as the wish. */
export function niceStep(wish: number): number {
  if (wish <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(wish));
  for (const m of [1, 2, 5, 10]) if (m * pow >= wish) return m * pow;
  return 10 * pow;
}

/** An axis with zero in the middle, wide enough for a reach in percentage points. Shared by the picture and by a table of them. */
function signedAxis(reach: number): { half: number; ticks: number[]; at: (points: number) => number } {
  const step = niceStep(reach / 2);
  const half = Math.ceil(reach / step) * step;
  const ticks: number[] = [];
  for (let t = -half; t <= half + 1e-9; t += step) ticks.push(Number(t.toFixed(6)));
  return { half, ticks, at: (p: number) => ((p + half) / (2 * half)) * 100 };
}

/** The most an interval and its middle reach from zero, in points, with room to spare. */
const reachOf = (lowP: number, highP: number, midP: number) => Math.max(Math.abs(lowP), Math.abs(highP), Math.abs(midP), 0.01) * 1.25;

export function rangeView(low: number, high: number, lift: number): RangeView | null {
  if (![low, high, lift].every(Number.isFinite) || low > high) return null;
  const lowP = low * 100;
  const highP = high * 100;
  const liftP = lift * 100;
  const { half, ticks, at } = signedAxis(reachOf(lowP, highP, liftP));
  return {
    min: -half,
    max: half,
    ticks,
    at,
    lowPct: at(lowP),
    highPct: at(highP),
    liftPct: at(liftP),
    zeroPct: 50,
    includesZero: lowP <= 0 && highP >= 0,
    direction: lowP > 0 ? "above" : highP < 0 ? "below" : "spans",
  };
}

/** The sentence a screen reader hears for the picture. */
export function rangeSentence(low: number, high: number, lift: number, level: number, signed: (v: number) => string, noun = "Lift"): string {
  const view = rangeView(low, high, lift);
  const base = `${noun} ${signed(lift)}, with a ${level} percent interval from ${signed(low)} to ${signed(high)}.`;
  if (!view) return base;
  if (view.direction === "above") return `${base} The whole interval is above zero.`;
  if (view.direction === "below") return `${base} The whole interval is below zero.`;
  return `${base} The interval includes zero, so this does not rule out no effect.`;
}

/**
 * A shared axis for a table, with a dot and a whisker in each row. Positions run from 0 to 100 along the axis, in the units the
 * axis is labeled in, which are percent for rates and percentage points for differences.
 */
export type Axis = {
  min: number;
  max: number;
  ticks: number[];
  at: (units: number) => number;
  /** A signed axis has zero in the middle. A rate axis starts at zero. */
  signed: boolean;
};

/** The shortest whisker drawn, as a share of the axis, so a range with no width still shows as a mark. */
export const WHISKER_MIN = 0.8;

type RateRow = { rate: number; low: number; high: number };
type DifferenceRow = { difference: number; low: number; high: number };

/** A zero based axis for rates between 0 and 1, built from every row so one axis serves the table. Null when there is nothing to draw. */
export function rateAxis(rows: readonly RateRow[]): Axis | null {
  if (rows.length === 0 || rows.some((r) => ![r.rate, r.low, r.high].every(Number.isFinite) || r.low > r.high)) return null;
  const top = Math.max(...rows.map((r) => Math.max(r.high, r.rate))) * 100;
  const reach = Math.min(100, Math.max(top, 0.01) * 1.05);
  const step = niceStep(reach / 5);
  const max = Math.min(100, Math.ceil(reach / step) * step);
  const ticks: number[] = [];
  for (let t = 0; t <= max + 1e-9; t += step) ticks.push(Number(t.toFixed(6)));
  if (ticks[ticks.length - 1] !== max) ticks.push(max);
  return { min: 0, max, ticks, at: (p) => (p / max) * 100, signed: false };
}

/** An axis with zero in the middle, for differences, built from every row so one axis serves the table. */
export function differenceAxis(rows: readonly DifferenceRow[]): Axis | null {
  if (rows.length === 0 || rows.some((r) => ![r.difference, r.low, r.high].every(Number.isFinite) || r.low > r.high)) return null;
  const reach = Math.max(...rows.map((r) => reachOf(r.low * 100, r.high * 100, r.difference * 100)));
  const { half, ticks, at } = signedAxis(reach);
  return { min: -half, max: half, ticks, at, signed: true };
}

export type Placement = {
  dotPct: number;
  lowPct: number;
  highPct: number;
  /** Where the whisker starts and how wide it is, never leaving the axis and never thinner than WHISKER_MIN. */
  leftPct: number;
  widthPct: number;
  crossesZero: boolean;
  reachesZero: boolean;
  direction: "above" | "below" | "spans";
};

const clamp = (v: number) => Math.min(100, Math.max(0, v));

/** Where a value and its range sit on a shared axis. Values are fractions, as the readouts hold them. */
export function place(axis: Axis, value: number, low: number, high: number): Placement | null {
  if (![value, low, high].every(Number.isFinite) || low > high) return null;
  const lowPct = clamp(axis.at(low * 100));
  const highPct = clamp(axis.at(high * 100));
  const widthPct = Math.max(highPct - lowPct, WHISKER_MIN);
  return {
    dotPct: clamp(axis.at(value * 100)),
    lowPct,
    highPct,
    leftPct: Math.min(lowPct, 100 - widthPct),
    widthPct,
    crossesZero: low <= 0 && high >= 0,
    reachesZero: low <= 0,
    direction: low > 0 ? "above" : high < 0 ? "below" : "spans",
  };
}

/** The sentence a screen reader hears for one row of a rate table. */
export function rateSentence(rate: number, low: number, high: number, axis: Axis, percent: (v: number) => string): string {
  const base = `Rate ${percent(rate)}, range from ${percent(low)} to ${percent(high)}, on an axis from 0 to ${axis.max} percent.`;
  return low <= 0 ? `${base} The range reaches zero.` : base;
}
