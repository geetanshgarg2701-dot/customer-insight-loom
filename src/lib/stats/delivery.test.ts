import { describe, expect, it } from "vitest";
import { deliverySummary } from "./delivery";

describe("deliverySummary, review finding R1-10", () => {
  it("returns nothing when no row said whether the email was received", () => {
    expect(
      deliverySummary({
        treatment: { reported: 0, received: 0 },
        control: { reported: 0, received: 0 },
        lift: 0.02,
      }),
    ).toBeNull();
  });

  it("reproduces the review case: 15 percent of control emailed by mistake dilutes a 2 point lift to 1.70", () => {
    const d = deliverySummary({
      treatment: { reported: 2000, received: 2000 },
      control: { reported: 2000, received: 300 },
      lift: 0.017,
    })!;
    expect(d.treatmentShare).toBe(1);
    expect(d.controlShare).toBeCloseTo(0.15, 10);
    expect(d.scaledLift).toBeCloseTo(0.02, 10);
    expect(d.note).toMatch(/15\.0 percent of the control group/);
    expect(d.note).toMatch(/assigned to the send/);
    expect(d.note).toMatch(/rough/);
  });

  it("flags undelivered treatment as well, and scales by the gap between the arms", () => {
    const d = deliverySummary({
      treatment: { reported: 1000, received: 800 },
      control: { reported: 1000, received: 0 },
      lift: 0.016,
    })!;
    expect(d.treatmentShare).toBeCloseTo(0.8, 10);
    expect(d.scaledLift).toBeCloseTo(0.02, 10);
    expect(d.note).toMatch(/20\.0 percent of the treatment group/);
  });

  it("says delivery was clean when treatment got it and control did not", () => {
    const d = deliverySummary({
      treatment: { reported: 500, received: 500 },
      control: { reported: 500, received: 0 },
      lift: 0.03,
    })!;
    expect(d.scaledLift).toBeCloseTo(0.03, 10);
    expect(d.note).toMatch(/matches the assignment/);
  });

  it("gives no scaled figure when the arms barely differ in delivery", () => {
    const d = deliverySummary({
      treatment: { reported: 500, received: 300 },
      control: { reported: 500, received: 270 },
      lift: 0.01,
    })!;
    expect(d.scaledLift).toBeNull();
    expect(d.note).toMatch(/too small to scale/);
  });

  it("handles an arm with no reports without dividing by zero", () => {
    const d = deliverySummary({
      treatment: { reported: 400, received: 400 },
      control: { reported: 0, received: 0 },
      lift: 0.02,
    })!;
    expect(d.controlShare).toBeNull();
    expect(d.scaledLift).toBeNull();
  });

  it("uses no em dash and no parentheses", () => {
    const d = deliverySummary({
      treatment: { reported: 1000, received: 800 },
      control: { reported: 1000, received: 150 },
      lift: 0.01,
    })!;
    expect(d.note).not.toMatch(/[\u2014()]/);
  });
});
