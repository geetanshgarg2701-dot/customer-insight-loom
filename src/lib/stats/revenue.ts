import { studentTQuantile } from "./distributions";
import { STATS_ENGINE_VERSION } from "./version";

/**
 * Revenue per recipient, plan section 6.2. The plan does not show incremental revenue as lift times audience times one
 * order value, because that has the wrong sign when a send changes order value. A discount that lifts conversion from
 * 10 to 12 percent while orders fall from 50 to 40 dollars gives revenue per recipient of 4.80 against 5.00, a loss, where
 * the shortcut shows a gain. So revenue is shown only when the results file reports it for everyone who converted, as the
 * difference of the two groups' revenue per recipient with a Welch interval. Without that, the lift is shown with no
 * revenue figure.
 *
 * Revenue per recipient counts everyone whose window has closed: their revenue if they converted, nothing if they did not.
 * This file is pure. The counts come from the results table.
 */

/**
 * One group, over the people whose conversion window has closed. Non-converters count as zero revenue. The sample variance
 * comes from the database's own stable function, not from sums of squares, which lose precision on large values.
 */
export type ArmMoney = { n: number; sum: number; variance: number; purchasers: number };

export type RevenueInput = {
  treatment: ArmMoney;
  control: ArmMoney;
  /** People who converted but have no usable revenue value. Any at all, and revenue is not shown. */
  unreportedConverters: number;
  /** Revenue cells that were not plain numbers. They count as not reported. */
  invalidValues: number;
  /** People marked as not converted who still had a revenue value. It is ignored. */
  ignoredOnNonConverters: number;
  alpha?: number;
};

export type ArmMean = { n: number; perRecipient: number; purchasers: number };

export type RevenueReadout =
  | {
      status: "shown";
      treatment: ArmMean;
      control: ArmMean;
      /** Treatment minus control, per recipient. */
      difference: number;
      low: number;
      high: number;
      df: number;
      significant: boolean;
      /** The difference times the number of treated people measured, with its range. Not a forecast. */
      overTreated: { n: number; estimate: number; low: number; high: number };
      alpha: number;
      notes: string[];
      method: string;
      engineVersion: string;
    }
  | { status: "means_only"; treatment: ArmMean; control: ArmMean; difference: number; text: string; notes: string[] }
  | { status: "not_shown"; reason: "unreported_converters" | "too_few_people"; text: string; notes: string[] };

/** Fewer purchases than this in a group, and an interval on revenue is not trustworthy: revenue is lopsided. */
export const MIN_PURCHASES = 30;

const METHOD =
  "Revenue per recipient is each group's revenue divided by the people whose window has closed, counting people who did not " +
  "buy as zero. The interval is the Welch interval for the difference of the two means, with the t distribution. Revenue is " +
  "lopsided, with many zeros and a few large orders, so the interval can be too narrow when purchases are few. This is why " +
  "it needs at least 30 purchases in each group. Order values are not assumed equal in the two groups.";

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function meanOf(a: ArmMoney): ArmMean {
  return { n: a.n, perRecipient: a.n === 0 ? 0 : a.sum / a.n, purchasers: a.purchasers };
}

export function revenueReadout(input: RevenueInput): RevenueReadout {
  const { treatment, control } = input;
  const alpha = input.alpha ?? 0.05;
  const notes: string[] = [];
  if (input.invalidValues > 0) {
    notes.push(
      input.invalidValues === 1
        ? "1 revenue value was not a plain number, so it counted as not reported."
        : `${input.invalidValues.toLocaleString("en-US")} revenue values were not plain numbers, so they counted as not reported.`,
    );
  }
  if (input.ignoredOnNonConverters > 0) {
    notes.push(`${plural(input.ignoredOnNonConverters, "person", "people")} marked as not converted had a revenue value, which was ignored.`);
  }

  if (input.unreportedConverters > 0) {
    return {
      status: "not_shown",
      reason: "unreported_converters",
      text:
        `${plural(input.unreportedConverters, "person who converted has", "people who converted have")} no revenue value, ` +
        "so revenue per recipient cannot be worked out. Fill those values, or leave the revenue column out and read the lift alone.",
      notes,
    };
  }
  if (treatment.n < 2 || control.n < 2) {
    return { status: "not_shown", reason: "too_few_people", text: "Each group needs at least two people with a closed window before revenue per recipient can be shown.", notes };
  }

  const t = meanOf(treatment);
  const c = meanOf(control);
  const difference = t.perRecipient - c.perRecipient;
  if (treatment.purchasers < MIN_PURCHASES || control.purchasers < MIN_PURCHASES) {
    return {
      status: "means_only",
      treatment: t,
      control: c,
      difference,
      text:
        `Each group needs at least ${MIN_PURCHASES} purchases before a range is shown, because revenue is lopsided and a range ` +
        `from fewer is not trustworthy. There ${treatment.purchasers === 1 ? "is 1 purchase" : `are ${treatment.purchasers.toLocaleString("en-US")} purchases`} ` +
        `in the treatment group and ${control.purchasers.toLocaleString("en-US")} in the control group. The two means are shown with no range.`,
      notes,
    };
  }

  const vt = Math.max(0, treatment.variance) / treatment.n;
  const vc = Math.max(0, control.variance) / control.n;
  const se = Math.sqrt(vt + vc);
  const denominator = (vt * vt) / (treatment.n - 1) + (vc * vc) / (control.n - 1);
  // With no spread in either group the interval is the point, and the degrees of freedom are the pooled count.
  const df = denominator === 0 ? treatment.n + control.n - 2 : (vt + vc) ** 2 / denominator;
  const half = se === 0 ? 0 : studentTQuantile(1 - alpha / 2, df) * se;
  const low = difference - half;
  const high = difference + half;
  return {
    status: "shown",
    treatment: t,
    control: c,
    difference,
    low,
    high,
    df,
    significant: low > 0 || high < 0,
    overTreated: { n: treatment.n, estimate: difference * treatment.n, low: low * treatment.n, high: high * treatment.n },
    alpha,
    notes,
    method: METHOD,
    engineVersion: STATS_ENGINE_VERSION,
  };
}
