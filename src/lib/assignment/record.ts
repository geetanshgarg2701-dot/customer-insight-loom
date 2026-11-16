import type { ExperimentReadout } from "../stats/experiment";
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
    computed_at: computedAt,
    engine_version: r.engineVersion,
    method: r.method,
  };
}
