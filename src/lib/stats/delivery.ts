export type DeliveryCounts = {
  /** People whose row said yes or no to having received the email. Blank or unreadable values do not count. */
  reported: number;
  received: number;
};

export type Delivery = {
  treatment: DeliveryCounts;
  control: DeliveryCounts;
  /** Share of reporting people who received it, or null when nobody in the arm reported. */
  treatmentShare: number | null;
  controlShare: number | null;
  /** The lift divided by the gap in delivery between the arms, or null when the gap is too small to trust. */
  scaledLift: number | null;
  note: string;
};

/** Below this gap in delivery between the arms, dividing by it would blow the lift up. */
const MIN_GAP = 0.1;

const share = (c: DeliveryCounts) => (c.reported > 0 ? c.received / c.reported : null);
const pct = (x: number) => `${(x * 100).toFixed(1)} percent`;
const points = (x: number) => `${(x * 100).toFixed(2)} points`;

/**
 * The readout is the effect of being assigned to the send. If part of the control group was emailed anyway, or
 * part of the treatment group never got it, that effect is smaller than the effect of receiving the email. This
 * puts the delivery shares next to the readout when the upload says who received the email, and gives a rough
 * scaling by the gap in delivery. It never changes the readout itself. Review finding R1-10.
 */
export function deliverySummary(input: {
  treatment: DeliveryCounts;
  control: DeliveryCounts;
  lift: number;
}): Delivery | null {
  const { treatment, control, lift } = input;
  if (treatment.reported + control.reported === 0) return null;
  const treatmentShare = share(treatment);
  const controlShare = share(control);

  const gaps: string[] = [];
  if (controlShare !== null && controlShare > 0) {
    gaps.push(`${pct(controlShare)} of the control group reported receiving the email.`);
  }
  if (treatmentShare !== null && treatmentShare < 1) {
    gaps.push(`${pct(1 - treatmentShare)} of the treatment group reported not receiving it.`);
  }

  let scaledLift: number | null = null;
  let gapPoints: string | null = null;
  let tooSmall = false;
  if (treatmentShare !== null && controlShare !== null) {
    const gap = treatmentShare - controlShare;
    if (gap >= MIN_GAP) {
      scaledLift = lift / gap;
      gapPoints = points(gap);
    } else {
      tooSmall = true;
    }
  }

  const parts: string[] = [];
  if (gaps.length === 0) {
    parts.push("Delivery matches the assignment: everyone who reported in treatment received the email and no one in control did.");
  } else {
    parts.push(...gaps);
    parts.push("The lift above is the effect of being assigned to the send, so these gaps pull it toward zero.");
    if (scaledLift !== null) {
      parts.push(
        `A rough scaling by the ${gapPoints} gap in delivery puts the effect on people who received it near ` +
          `${points(scaledLift)}. The interval is not scaled, and this is not a tested estimate.`,
      );
    } else if (tooSmall) {
      parts.push("The difference in delivery between the arms is too small to scale the lift.");
    }
  }
  return { treatment, control, treatmentShare, controlShare, scaledLift, note: parts.join(" ") };
}
