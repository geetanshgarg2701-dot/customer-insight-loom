import type { ExperimentReadout } from "../stats/experiment";
import type { RevenueReadout } from "../stats/revenue";
import type { Verification } from "./assign";

type Readable = Extract<ExperimentReadout, { status: "readable" }>;

/**
 * The result written to a ledger entry: aggregates, the method and the engine
 * version only. No email, no hash and no row level data. Used by the results
 * screen and by the demo seed, so both store the same shape.
 */
export function resultRecord(readout: Readable, verification: Verification, computedAt: string) {
  const r = readout.readout;
  return {
    lift: r.lift,
    interval_low: r.interval.low,
    interval_high: r.interval.high,
    significant: r.significant,
    alpha: r.alpha,
    p_value: r.pValue,
    treatment_rate: r.treatmentRate,
    control_rate: r.controlRate,
    sample_sizes: r.sampleSizes,
    srm_pass: readout.srm.pass,
    srm_p_value: readout.srm.pValue,
    pending: readout.counts.treatment.pending + readout.counts.control.pending,
    verification,
    // Aggregates only. Present when the upload had a received column.
    delivery: readout.delivery
      ? {
          treatment_share: readout.delivery.treatmentShare,
          control_share: readout.delivery.controlShare,
          scaled_lift: readout.delivery.scaledLift,
        }
      : null,
    computed_at: computedAt,
    engine_version: r.engineVersion,
    method: r.method,
  };
}

/**
 * The revenue part of a stored result, or null when revenue was not shown. Aggregates only: the two means, the difference
 * and its interval. A result with no revenue part is the same as one stored before revenue existed.
 */
export function revenueRecord(revenue: RevenueReadout | null) {
  if (revenue === null || revenue.status === "not_shown") return null;
  const arm = (a: { n: number; perRecipient: number; purchasers: number }) => ({ n: a.n, per_recipient: a.perRecipient, purchasers: a.purchasers });
  if (revenue.status === "means_only") {
    return { status: "means_only" as const, treatment: arm(revenue.treatment), control: arm(revenue.control), difference: revenue.difference };
  }
  return {
    status: "shown" as const,
    treatment: arm(revenue.treatment),
    control: arm(revenue.control),
    difference: revenue.difference,
    interval_low: revenue.low,
    interval_high: revenue.high,
    significant: revenue.significant,
    alpha: revenue.alpha,
    over_treated: revenue.overTreated,
    method: revenue.method,
  };
}
