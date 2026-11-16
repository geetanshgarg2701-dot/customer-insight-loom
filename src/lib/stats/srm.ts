import { chiSquareSurvival } from "./distributions";
import { STATS_ENGINE_VERSION } from "./version";

/** Plan section 6.2. A common industry threshold, shown on screen as judgment. */
export const SRM_THRESHOLD = 0.001;

export type SrmResult = {
  observed: { treatment: number; control: number };
  expected: { treatment: number; control: number };
  statistic: number;
  pValue: number;
  threshold: number;
  /** False blocks the readout. */
  pass: boolean;
  method: string;
  engineVersion: string;
};

/** Chi square goodness of fit on assigned counts against the planned split. */
export function sampleRatioCheck(
  observed: { treatment: number; control: number },
  treatmentShare: number,
): SrmResult {
  const { treatment, control } = observed;
  for (const v of [treatment, control]) {
    if (!Number.isInteger(v) || v < 0) throw new RangeError("Assigned counts must be whole numbers >= 0.");
  }
  if (!(treatmentShare > 0 && treatmentShare < 1)) {
    throw new RangeError("Treatment share must be strictly between 0 and 1.");
  }
  const total = treatment + control;
  if (total === 0) throw new RangeError("No one is assigned yet.");

  const eT = total * treatmentShare;
  const eC = total * (1 - treatmentShare);
  const statistic = (treatment - eT) ** 2 / eT + (control - eC) ** 2 / eC;
  const pValue = chiSquareSurvival(statistic, 1);
  return {
    observed: { treatment, control },
    expected: { treatment: eT, control: eC },
    statistic,
    pValue,
    threshold: SRM_THRESHOLD,
    pass: pValue >= SRM_THRESHOLD,
    method:
      `Chi square goodness of fit test on everyone assigned, against the planned split, 1 degree of freedom. ` +
      `Flagged when p is below ${SRM_THRESHOLD}, a common industry threshold, labeled judgment.`,
    engineVersion: STATS_ENGINE_VERSION,
  };
}
