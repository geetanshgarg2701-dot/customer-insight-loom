import { formatPoints } from "./format";

type End = number;

function endWords(value: End): string {
  const shown = Number((value * 100).toFixed(2));
  if (shown === 0) return "no change";
  return shown < 0 ? `a loss of ${formatPoints(Math.abs(value))}` : `a gain of ${formatPoints(value)}`;
}

/**
 * Plain words for a readout. A "not significant" label alone reads as "no effect", which is wrong for a small
 * list. When the interval spans zero the screen says inconclusive and names both ends.
 */
export function describeVerdict(r: {
  significant: boolean;
  /** Treatment rate minus control rate, as a proportion. */
  lift: number;
  interval: { low: number; high: number };
}): {
  label: string;
  text: string;
} {
  if (r.significant) {
    // A significant result from a small test tends to read larger than the truth, because only the lucky
    // draws cross the line. The interval reaching below half of the lift is the sign of a small test.
    const nearZero = Math.min(Math.abs(r.interval.low), Math.abs(r.interval.high));
    const runsHigh = nearZero < Math.abs(r.lift) / 2;
    return {
      label: "Significant: yes",
      text:
        "The interval excludes zero, so these data are not consistent with no difference." +
        (runsHigh
          ? " The interval is wide compared with the lift, which marks a small test. Significant results from small tests " +
            "run high, so treat the lift as an upper estimate and plan the next test on the low end of the interval."
          : ""),
    };
  }
  return {
    label: "Significant: no",
    text:
      `Inconclusive. The data fit anything from ${endWords(r.interval.low)} to ${endWords(r.interval.high)}. ` +
      `This does not show the send had no effect. A larger list or a bigger lift would be needed to tell.`,
  };
}
