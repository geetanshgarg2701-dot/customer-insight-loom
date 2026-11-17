import { normalCdf, normalQuantile } from "./distributions";
import { STATS_ENGINE_VERSION } from "./version";

export type ArmOutcome = { n: number; conversions: number };
export type Interval = { low: number; high: number };

function checkArm(arm: ArmOutcome, label: string) {
  const { n, conversions } = arm;
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`The ${label} arm needs at least 1 person.`);
  }
  if (!Number.isInteger(conversions) || conversions < 0 || conversions > n) {
    throw new RangeError(`The ${label} arm has an impossible conversion count.`);
  }
}

function checkAlpha(alpha: number) {
  if (!(alpha > 0 && alpha < 1)) throw new RangeError("alpha must be strictly between 0 and 1.");
}

function percent(level: number): string {
  return `${Number((level * 100).toFixed(6))} percent`;
}

/** Wilson score interval for one proportion. */
export function wilsonInterval(x: number, n: number, alpha: number): Interval {
  checkArm({ n, conversions: x }, "given");
  checkAlpha(alpha);
  const z = normalQuantile(1 - alpha / 2);
  const p = x / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return {
    low: x === 0 ? 0 : Math.max(0, center - half),
    high: x === n ? 1 : Math.min(1, center + half),
  };
}

/**
 * Interval for p1 minus p2 by the hybrid score method, method 10 in
 * Newcombe 1998, Statistics in Medicine 17, pages 873 to 890.
 */
export function newcombeDifference(
  x1: number,
  n1: number,
  x2: number,
  n2: number,
  alpha: number,
): Interval {
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const w1 = wilsonInterval(x1, n1, alpha);
  const w2 = wilsonInterval(x2, n2, alpha);
  const d = p1 - p2;
  return {
    low: Math.max(-1, d - Math.sqrt((p1 - w1.low) ** 2 + (w2.high - p2) ** 2)),
    high: Math.min(1, d + Math.sqrt((w1.high - p1) ** 2 + (p2 - w2.low) ** 2)),
  };
}

/** Two sided p value of the pooled two proportion z test. Used for multiple comparison correction. */
export function twoProportionPValue(x1: number, n1: number, x2: number, n2: number): number {
  checkArm({ n: n1, conversions: x1 }, "first");
  checkArm({ n: n2, conversions: x2 }, "second");
  const pooled = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return 1;
  const z = (x1 / n1 - x2 / n2) / se;
  return Math.min(1, 2 * normalCdf(-Math.abs(z)));
}

export type Readout = {
  treatmentRate: number;
  controlRate: number;
  /** Treatment rate minus control rate, as a proportion. */
  lift: number;
  interval: Interval;
  /** True when the interval excludes zero. */
  significant: boolean;
  /** Pooled z test p value, for multiple comparison correction across a screen. */
  pValue: number;
  alpha: number;
  sampleSizes: { treatment: number; control: number };
  method: string;
  engineVersion: string;
};

export function readout(input: {
  treatment: ArmOutcome;
  control: ArmOutcome;
  alpha?: number;
}): Readout {
  const { treatment, control, alpha = 0.05 } = input;
  checkArm(treatment, "treatment");
  checkArm(control, "control");
  checkAlpha(alpha);
  const treatmentRate = treatment.conversions / treatment.n;
  const controlRate = control.conversions / control.n;
  const interval = newcombeDifference(
    treatment.conversions,
    treatment.n,
    control.conversions,
    control.n,
    alpha,
  );
  return {
    treatmentRate,
    controlRate,
    lift: treatmentRate - controlRate,
    interval,
    significant: interval.low > 0 || interval.high < 0,
    pValue: twoProportionPValue(treatment.conversions, treatment.n, control.conversions, control.n),
    alpha,
    sampleSizes: { treatment: treatment.n, control: control.n },
    method:
      `Lift is the treatment conversion rate minus the control conversion rate. ` +
      `The ${percent(1 - alpha)} interval uses the Newcombe hybrid score method, ` +
      `method 10 in Newcombe 1998, built from Wilson score intervals. ` +
      `Significant means the interval excludes zero. ` +
      `The p value is from the pooled two proportion z test. It orders tests for Benjamini Hochberg and is not used for the ` +
      `significant call, so for very small counts the two can disagree. ` +
      `Fixed horizon: read once, after the conversion window closes.`,
    engineVersion: STATS_ENGINE_VERSION,
  };
}

export type RevenueRange = {
  estimate: number;
  low: number;
  high: number;
  note: string;
  method: string;
};

/** Plan section 6.2: lift times treated audience times average order value, with the lift interval as the range. */
export function incrementalRevenue(
  result: { lift: number; interval: Interval },
  treatedAudience: number,
  averageOrderValue: number,
): RevenueRange {
  if (!(treatedAudience >= 0) || !Number.isFinite(treatedAudience)) {
    throw new RangeError("Treated audience must be a number >= 0.");
  }
  if (!(averageOrderValue >= 0) || !Number.isFinite(averageOrderValue)) {
    throw new RangeError("Average order value must be a number >= 0.");
  }
  const scale = treatedAudience * averageOrderValue;
  return {
    estimate: result.lift * scale,
    low: result.interval.low * scale,
    high: result.interval.high * scale,
    note:
      "Revenue carries extra spread beyond this range because order values vary. This assumes the same average order value in both arms. If the send changes order value, for example through a discount, the sign can be wrong, so compare revenue per recipient in each arm instead.",
    method:
      "Lift and its interval endpoints multiplied by the treated audience size and one average order value from the same window, which assumes the order value is equal in both arms.",
  };
}
