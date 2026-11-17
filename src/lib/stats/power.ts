import { normalQuantile } from "./distributions";
import { STATS_ENGINE_VERSION } from "./version";

export type PowerInput = {
  /** Control conversion rate from the user's own past data, as a proportion. */
  baselineRate: number;
  /** Smallest absolute lift worth detecting, as a proportion. 0.01 means one point. */
  minDetectableLift: number;
  /** Share of the audience assigned to treatment. */
  treatmentShare: number;
  /** People available for the test, both arms together. */
  audienceSize: number;
  alpha?: number;
  power?: number;
};

export type PowerResult = {
  requiredTreatment: number;
  requiredControl: number;
  requiredTotal: number;
  availableTreatment: number;
  availableControl: number;
  pass: boolean;
  /**
   * The smallest absolute lift this audience can detect at the same alpha, power and split, as a proportion.
   * Null when no lift below 100 percent could be detected. A pass for a large lift can hide a weak audience,
   * so this is shown next to the pass message. Missing on results saved before it existed.
   */
  smallestDetectableLift: number | null;
  alpha: number;
  power: number;
  method: string;
  engineVersion: string;
};

function requiredPerArm(p: number, d: number, s: number, alpha: number, power: number) {
  const pT = p + d;
  const pC = p;
  const pBar = s * pT + (1 - s) * pC;
  const zA = normalQuantile(1 - alpha / 2);
  const zB = normalQuantile(power);
  const nullPart = zA * Math.sqrt(pBar * (1 - pBar) * (1 / s + 1 / (1 - s)));
  const altPart = zB * Math.sqrt((pT * (1 - pT)) / s + (pC * (1 - pC)) / (1 - s));
  const total = (nullPart + altPart) ** 2 / (d * d);
  return { requiredTreatment: Math.ceil(total * s), requiredControl: Math.ceil(total * (1 - s)) };
}

/** Bisection on the lift. The people needed fall as the lift grows, so the passing lifts start at one point. */
function smallestLift(
  p: number,
  s: number,
  alpha: number,
  power: number,
  availableTreatment: number,
  availableControl: number,
): number | null {
  const fits = (d: number) => {
    const r = requiredPerArm(p, d, s, alpha, power);
    return availableTreatment >= r.requiredTreatment && availableControl >= r.requiredControl;
  };
  let low = 1e-6;
  let high = 1 - p - 1e-6;
  if (!(high > low) || !fits(high)) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2;
    if (fits(mid)) high = mid;
    else low = mid;
  }
  return high;
}

/**
 * Sample size for a two sided two proportion z test with unequal allocation,
 * normal approximation without continuity correction. With an even split,
 * alpha 0.05 and power 0.80 it lands close to the plan's rule of thumb of
 * 16 p times 1 minus p over d squared, a little above it.
 */
export function powerCheck(input: PowerInput): PowerResult {
  const { baselineRate: p, minDetectableLift: d, treatmentShare: s, audienceSize } = input;
  const alpha = input.alpha ?? 0.05;
  const power = input.power ?? 0.8;

  if (!(p > 0 && p < 1)) throw new RangeError("Baseline rate must be strictly between 0 and 1.");
  if (!(d > 0) || !(p + d < 1)) {
    throw new RangeError("Minimum detectable lift must be above 0, and baseline plus lift below 1.");
  }
  if (!(s > 0 && s < 1)) throw new RangeError("Treatment share must be strictly between 0 and 1.");
  if (!Number.isInteger(audienceSize) || audienceSize < 0) {
    throw new RangeError("Audience size must be a whole number >= 0.");
  }
  if (!(alpha > 0 && alpha < 1)) throw new RangeError("alpha must be strictly between 0 and 1.");
  if (!(power > 0 && power < 1)) throw new RangeError("power must be strictly between 0 and 1.");

  const { requiredTreatment, requiredControl } = requiredPerArm(p, d, s, alpha, power);
  const availableTreatment = Math.floor(audienceSize * s);
  const availableControl = audienceSize - availableTreatment;

  return {
    requiredTreatment,
    requiredControl,
    requiredTotal: requiredTreatment + requiredControl,
    availableTreatment,
    availableControl,
    pass: availableTreatment >= requiredTreatment && availableControl >= requiredControl,
    smallestDetectableLift: smallestLift(p, s, alpha, power, availableTreatment, availableControl),
    alpha,
    power,
    method:
      `Two sided two proportion z test, normal approximation without continuity correction, ` +
      `alpha ${alpha}, power ${power}, treatment share ${s}, baseline ${p}, absolute lift ${d}.`,
    engineVersion: STATS_ENGINE_VERSION,
  };
}
