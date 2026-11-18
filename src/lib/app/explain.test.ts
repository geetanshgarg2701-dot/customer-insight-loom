import { describe, expect, it } from "vitest";
import { powerCheck } from "../stats/power";
import { readout } from "../stats/readout";
import { formatCount, formatPercent, formatSignedPoints } from "./format";
import { explainPower, explainReadout } from "./explain";

const result = readout({ treatment: { n: 1000, conversions: 120 }, control: { n: 1000, conversions: 100 } });
const counts = {
  treatment: { n: 1000, conversions: 120, pending: 0, assigned: 1000 },
  control: { n: 1000, conversions: 100, pending: 0, assigned: 1000 },
};

const find = <T extends { label: string }>(list: T[], label: string): T => list.find((e) => e.label === label)!;

describe("explainReadout", () => {
  const list = explainReadout(result, counts);

  it("explains each rate from the counts it came from", () => {
    const t = find(list, "Treatment rate");
    expect(t.value).toBe(formatPercent(result.treatmentRate));
    expect(t.how).toContain("120 converted of 1,000 people");
    expect(t.how).toContain("12.00 percent");
    expect(find(list, "Control rate").how).toContain("100 converted of 1,000 people");
  });

  it("shows the lift as one rate minus the other, with the same figures as the table", () => {
    const lift = find(list, "Lift");
    expect(lift.value).toBe(formatSignedPoints(result.lift));
    expect(lift.how).toContain("12.00 percent minus 10.00 percent");
    expect(lift.how).toContain("+2.00 points");
  });

  it("names the interval method and gives both ends, and says what a zero crossing means", () => {
    const interval = find(list, "95 percent interval");
    expect(interval.how).toMatch(/Newcombe hybrid score/);
    expect(interval.how).toMatch(/Newcombe 1998/);
    expect(interval.how).toContain(formatSignedPoints(result.interval.low));
    expect(interval.how).toContain(formatSignedPoints(result.interval.high));
    expect(interval.how).toMatch(/includes zero|excludes zero/);
  });

  it("explains the people counted, and says who is left out", () => {
    const n = find(list, "People counted");
    expect(n.how).toMatch(/conversion window has closed/);
    const withPending = explainReadout(result, {
      treatment: { ...counts.treatment, pending: 40 },
      control: { ...counts.control, pending: 25 },
    });
    expect(find(withPending, "People counted").how).toContain("65 people");
    expect(find(withPending, "People counted").how).toMatch(/excluded/);
  });

  it("explains the p value as the test that orders comparisons, not the significance call", () => {
    const p = find(list, "p value");
    expect(p.value).toBe(result.pValue.toPrecision(3));
    expect(p.how).toMatch(/pooled two proportion z test/);
    expect(p.how).toMatch(/not used for the significant call/);
  });

  it("does not say a multiple comparison correction is applied, because none runs", () => {
    const p = find(list, "p value");
    expect(p.how).not.toMatch(/used to order comparisons for multiple comparison correction/);
    expect(p.how).toMatch(/no multiple comparison correction runs/);
  });

  it("explains the significance call from the interval", () => {
    const s = find(list, "Significant");
    expect(s.value).toBe(result.significant ? "yes" : "no");
    expect(s.how).toMatch(/interval/);
  });

  it("uses no em dash and no parentheses anywhere", () => {
    for (const e of list) expect(`${e.label} ${e.value} ${e.how}`).not.toMatch(/[—()]/);
  });

  it("changes with the data: the same text for different counts would be a bug", () => {
    const other = readout({ treatment: { n: 400, conversions: 60 }, control: { n: 400, conversions: 40 } });
    const otherList = explainReadout(other, {
      treatment: { n: 400, conversions: 60, pending: 0, assigned: 400 },
      control: { n: 400, conversions: 40, pending: 0, assigned: 400 },
    });
    expect(find(otherList, "Treatment rate").how).toContain("60 converted of 400 people");
    expect(find(otherList, "Treatment rate").how).not.toContain("120");
  });
});

describe("explainPower", () => {
  const input = { baselineRate: 0.1, minDetectableLift: 0.02, treatmentShare: 0.5, audienceSize: 10_000 };
  const power = powerCheck(input);
  const list = explainPower(power, input);

  it("shows the required people from the inputs and the formula's name", () => {
    const required = find(list, "Required per arm");
    expect(required.value).toBe(`${formatCount(power.requiredTreatment)} treatment, ${formatCount(power.requiredControl)} control`);
    expect(required.how).toContain("baseline of 10.00 percent");
    expect(required.how).toContain("2.00 points");
    expect(required.how).toMatch(/two proportion/);
    expect(required.how).toContain("0.05");
    expect(required.how).toContain("0.8");
  });

  it("shows how the available people were split", () => {
    const available = find(list, "Available per arm");
    expect(available.how).toContain("10,000 people");
    expect(available.how).toContain("50 percent");
    expect(available.value).toBe(`${formatCount(power.availableTreatment)} treatment, ${formatCount(power.availableControl)} control`);
  });

  it("explains the smallest detectable lift, and says so when none can be found", () => {
    const smallest = find(list, "Smallest lift this audience can detect");
    expect(smallest.how).toMatch(/search/);
    const tiny = { ...input, audienceSize: 4 };
    const none = explainPower(powerCheck(tiny), tiny);
    expect(find(none, "Smallest lift this audience can detect").value).toBe("none");
  });

  it("says whether the check passed and why", () => {
    expect(find(list, "Result").value).toBe("passed");
    const short = { ...input, audienceSize: 7_000 };
    const failed = explainPower(powerCheck(short), short);
    expect(find(failed, "Result").value).toBe("failed");
    expect(find(failed, "Result").how).toMatch(/fewer than/);
  });

  it("uses no em dash and no parentheses anywhere", () => {
    for (const e of list) expect(`${e.label} ${e.value} ${e.how}`).not.toMatch(/[—()]/);
  });
});
