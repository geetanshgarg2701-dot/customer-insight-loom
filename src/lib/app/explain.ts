import type { PowerInput, PowerResult } from "../stats/power";
import type { Readout } from "../stats/readout";
import { formatCount, formatPercent, formatPoints, formatSignedPoints } from "./format";

/**
 * "How was this worked out", for the numbers on the design and results screens. Every sentence is built from the
 * values the numbers came from, so the words cannot drift from the figures. Nothing here computes a statistic. It
 * only describes what the statistics code already did.
 */

export type Explanation = { label: string; value: string; how: string };

type Arm = { n: number; conversions: number; pending: number; assigned: number };

const n0 = formatCount;

export function explainReadout(r: Readout, counts: { treatment: Arm; control: Arm }): Explanation[] {
  const level = `${Number(((1 - r.alpha) * 100).toFixed(6))} percent`;
  const excluded = counts.treatment.pending + counts.control.pending;
  const crossesZero = r.interval.low <= 0 && r.interval.high >= 0;
  return [
    {
      label: "Treatment rate",
      value: formatPercent(r.treatmentRate),
      how:
        `${n0(counts.treatment.conversions)} converted of ${n0(counts.treatment.n)} people in the treatment group ` +
        `whose conversion window has closed. ${n0(counts.treatment.conversions)} divided by ${n0(counts.treatment.n)} is ${formatPercent(r.treatmentRate)}.`,
    },
    {
      label: "Control rate",
      value: formatPercent(r.controlRate),
      how:
        `${n0(counts.control.conversions)} converted of ${n0(counts.control.n)} people in the control group ` +
        `whose conversion window has closed. ${n0(counts.control.conversions)} divided by ${n0(counts.control.n)} is ${formatPercent(r.controlRate)}.`,
    },
    {
      label: "Lift",
      value: formatSignedPoints(r.lift),
      how:
        `The treatment rate minus the control rate: ${formatPercent(r.treatmentRate)} minus ${formatPercent(r.controlRate)} ` +
        `is ${formatSignedPoints(r.lift)}. It is a difference in percentage points, not a relative change.`,
    },
    {
      label: `${level} interval`,
      value: `${formatSignedPoints(r.interval.low)} to ${formatSignedPoints(r.interval.high)}`,
      how:
        `The Newcombe hybrid score method, method 10 in Newcombe 1998, built from a Wilson score interval for each ` +
        `group. At ${level}, the interval runs from ${formatSignedPoints(r.interval.low)} to ${formatSignedPoints(r.interval.high)}. ` +
        (crossesZero
          ? "It includes zero, so these data cannot tell a gain from a loss."
          : "It excludes zero, so these data are not consistent with no difference."),
    },
    {
      label: "People counted",
      value: `${n0(counts.treatment.n)} treatment, ${n0(counts.control.n)} control`,
      how:
        `Only people whose conversion window has closed are counted, so nobody who might still convert is scored as a ` +
        `non converter. ` +
        (excluded > 0
          ? `${n0(excluded)} people whose window is still open are excluded and shown separately.`
          : "Nobody was excluded for an open window."),
    },
    {
      label: "p value",
      value: r.pValue.toPrecision(3),
      how:
        `From the pooled two proportion z test, two sided. It is used to order comparisons for multiple comparison ` +
        `correction and is not used for the significant call, so for very small counts it can disagree with the interval.`,
    },
    {
      label: "Significant",
      value: r.significant ? "yes" : "no",
      how: `Yes only when the ${level} interval excludes zero. Here the interval ${crossesZero ? "includes" : "excludes"} zero.`,
    },
  ];
}

export function explainPower(p: PowerResult, input: PowerInput): Explanation[] {
  const alpha = p.alpha;
  const required = `${n0(p.requiredTreatment)} treatment, ${n0(p.requiredControl)} control`;
  const smallest = p.smallestDetectableLift;
  return [
    {
      label: "Required per arm",
      value: required,
      how:
        `The exact two proportion sample size, two sided, alpha ${alpha} and power ${p.power}, for a baseline of ` +
        `${formatPercent(input.baselineRate)} and a lift of ${formatPoints(input.minDetectableLift)}, with ${formatPercent(input.treatmentShare, 0)} ` +
        `of people in treatment. The shortcut of 16 times the rate times one minus the rate over the lift squared is not used, because it undercounts.`,
    },
    {
      label: "Available per arm",
      value: `${n0(p.availableTreatment)} treatment, ${n0(p.availableControl)} control`,
      how:
        `${n0(input.audienceSize)} people available, split ${formatPercent(input.treatmentShare, 0)} to treatment. ` +
        `The treatment group is rounded down and the rest go to control.`,
    },
    {
      label: "Smallest lift this audience can detect",
      value: smallest === null ? "none" : formatPoints(smallest),
      how:
        smallest === null
          ? "No lift below 100 percent could be detected with this audience, so there is no smallest lift."
          : `Found by search: the smallest lift for which the people needed are no more than the people available, at the same alpha, power and split. A real lift below this would usually be missed.`,
    },
    {
      label: "Result",
      value: p.pass ? "passed" : "failed",
      how: p.pass
        ? "Both groups have at least the people required."
        : "One or both groups have fewer than the people required, so the audience is too small for this lift.",
    },
  ];
}
