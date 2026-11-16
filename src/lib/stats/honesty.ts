/**
 * Statistical honesty harness, plan section 6.3. Runs the real engine on
 * generated data and reports counts. These checks verify the calculator,
 * not any real world result, and the methods page must say so.
 */
import { binomialCentralRange } from "./distributions";
import { powerCheck } from "./power";
import { readout, type ArmOutcome } from "./readout";
import { STATS_ENGINE_VERSION } from "./version";

/** Small seeded generator, so every reported count can be reproduced exactly. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Binomial draw as a sum of n Bernoulli trials. Exact, and fast enough at these sizes. */
export function binomialSample(rng: () => number, n: number, p: number): number {
  let k = 0;
  for (let i = 0; i < n; i++) if (rng() < p) k++;
  return k;
}

export const HONESTY_NOTE =
  "These checks ran on generated data. They verify the calculator, not any real world result.";

type Decide = (treatment: ArmOutcome, control: ArmOutcome) => boolean;

export type AaResult = {
  experiments: number;
  nPerArm: number;
  rate: number;
  alpha: number;
  seed: number;
  significantCount: number;
  expectedCount: number;
  band: { low: number; high: number };
  withinBand: boolean;
  method: string;
  note: string;
  engineVersion: string;
};

/** Both arms draw from the same rate, so every significant call is a false positive. */
export function runAaSimulation(input: {
  experiments: number;
  nPerArm: number;
  rate: number;
  seed: number;
  alpha?: number;
  /** For testing the harness itself. Defaults to the real engine. */
  decide?: Decide;
}): AaResult {
  const { experiments, nPerArm, rate, seed } = input;
  const alpha = input.alpha ?? 0.05;
  const decide: Decide =
    input.decide ?? ((treatment, control) => readout({ treatment, control, alpha }).significant);
  const rng = mulberry32(seed);
  let significantCount = 0;
  for (let i = 0; i < experiments; i++) {
    const treatment = { n: nPerArm, conversions: binomialSample(rng, nPerArm, rate) };
    const control = { n: nPerArm, conversions: binomialSample(rng, nPerArm, rate) };
    if (decide(treatment, control)) significantCount++;
  }
  const band = binomialCentralRange(experiments, alpha, 0.95);
  return {
    experiments,
    nPerArm,
    rate,
    alpha,
    seed,
    significantCount,
    expectedCount: experiments * alpha,
    band,
    withinBand: significantCount >= band.low && significantCount <= band.high,
    method:
      `${experiments} simulated experiments with both arms at rate ${rate}, ${nPerArm} people per arm, seed ${seed}. ` +
      `The band is the central 95 percent range of a binomial with n ${experiments} and p ${alpha}, computed.`,
    note: HONESTY_NOTE,
    engineVersion: STATS_ENGINE_VERSION,
  };
}

export type PlantedResult = {
  experiments: number;
  baselineRate: number;
  lift: number;
  treatmentShare: number;
  nTreatment: number;
  nControl: number;
  alpha: number;
  power: number;
  seed: number;
  coverageCount: number;
  expectedCoverage: number;
  coverageBand: { low: number; high: number };
  coverageWithinBand: boolean;
  detectedCount: number;
  promisedCount: number;
  /** Lowest detection count still consistent with the stated power, at 95 percent. */
  promiseFloor: number;
  promiseHeld: boolean;
  method: string;
  note: string;
  engineVersion: string;
};

/**
 * Experiments with a known true lift, sized exactly by the power check, so
 * the check's promise is tested at its own sample size.
 */
export function runPlantedLift(input: {
  experiments: number;
  baselineRate: number;
  lift: number;
  treatmentShare: number;
  seed: number;
  alpha?: number;
  power?: number;
  /** For testing the harness itself. Defaults to alpha. */
  intervalAlpha?: number;
}): PlantedResult {
  const { experiments, baselineRate, lift, treatmentShare, seed } = input;
  const alpha = input.alpha ?? 0.05;
  const power = input.power ?? 0.8;
  const intervalAlpha = input.intervalAlpha ?? alpha;
  const design = powerCheck({
    baselineRate,
    minDetectableLift: lift,
    treatmentShare,
    audienceSize: 0,
    alpha,
    power,
  });
  const nTreatment = design.requiredTreatment;
  const nControl = design.requiredControl;

  const rng = mulberry32(seed);
  let coverageCount = 0;
  let detectedCount = 0;
  for (let i = 0; i < experiments; i++) {
    const r = readout({
      treatment: { n: nTreatment, conversions: binomialSample(rng, nTreatment, baselineRate + lift) },
      control: { n: nControl, conversions: binomialSample(rng, nControl, baselineRate) },
      alpha: intervalAlpha,
    });
    if (r.interval.low <= lift && lift <= r.interval.high) coverageCount++;
    // Detected means significant in the direction of the planted lift.
    if (r.interval.low > 0) detectedCount++;
  }

  const coverageBand = binomialCentralRange(experiments, 1 - alpha, 0.95);
  const promiseFloor = binomialCentralRange(experiments, power, 0.95).low;
  return {
    experiments,
    baselineRate,
    lift,
    treatmentShare,
    nTreatment,
    nControl,
    alpha,
    power,
    seed,
    coverageCount,
    expectedCoverage: Math.round(experiments * (1 - alpha)),
    coverageBand,
    coverageWithinBand: coverageCount >= coverageBand.low && coverageCount <= coverageBand.high,
    detectedCount,
    promisedCount: Math.round(experiments * power),
    promiseFloor,
    promiseHeld: detectedCount >= promiseFloor,
    method:
      `${experiments} simulated experiments with a true lift of ${lift} on a baseline of ${baselineRate}, ` +
      `sized by the power check at alpha ${alpha} and power ${power}, seed ${seed}. ` +
      `Bands are central 95 percent binomial ranges, computed. The promise floor is a judgment: ` +
      `the lowest detection count a correct power check would still produce 97.5 percent of the time.`,
    note: HONESTY_NOTE,
    engineVersion: STATS_ENGINE_VERSION,
  };
}
