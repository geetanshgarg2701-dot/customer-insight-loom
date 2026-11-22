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
function niceStep(wish: number): number {
  if (wish <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(wish));
  for (const m of [1, 2, 5, 10]) if (m * pow >= wish) return m * pow;
  return 10 * pow;
}

export function rangeView(low: number, high: number, lift: number): RangeView | null {
  if (![low, high, lift].every(Number.isFinite) || low > high) return null;
  const lowP = low * 100;
  const highP = high * 100;
  const liftP = lift * 100;
  const reach = Math.max(Math.abs(lowP), Math.abs(highP), Math.abs(liftP), 0.01) * 1.25;
  const step = niceStep(reach / 2);
  const half = Math.ceil(reach / step) * step;
  const ticks: number[] = [];
  for (let t = -half; t <= half + 1e-9; t += step) ticks.push(Number(t.toFixed(6)));
  const at = (p: number) => ((p + half) / (2 * half)) * 100;
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
export function rangeSentence(low: number, high: number, lift: number, level: number, signed: (v: number) => string): string {
  const view = rangeView(low, high, lift);
  const base = `Lift ${signed(lift)}, with a ${level} percent interval from ${signed(low)} to ${signed(high)}.`;
  if (!view) return base;
  if (view.direction === "above") return `${base} The whole interval is above zero.`;
  if (view.direction === "below") return `${base} The whole interval is below zero.`;
  return `${base} The interval includes zero, so this does not rule out no effect.`;
}
