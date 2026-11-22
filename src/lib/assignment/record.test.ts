import { describe, expect, it } from "vitest";
import { revenueRecord } from "./record";
import { revenueReadout, type ArmMoney } from "../stats/revenue";

const arm = (n: number, mean: number, variance: number, purchasers: number): ArmMoney => ({ n, sum: n * mean, variance, purchasers });
const none = { unreportedConverters: 0, invalidValues: 0, ignoredOnNonConverters: 0 };

describe("the revenue part of a stored result", () => {
  it("is nothing when there was no revenue column, or revenue was not shown", () => {
    expect(revenueRecord(null)).toBeNull();
    expect(revenueRecord(revenueReadout({ treatment: arm(100, 10, 200, 40), control: arm(100, 5, 100, 35), ...none, unreportedConverters: 2 }))).toBeNull();
  });

  it("holds the aggregates and the interval when revenue was shown, and nothing about any person", () => {
    const rec = revenueRecord(revenueReadout({ treatment: arm(100, 10, 200, 40), control: arm(100, 5, 100, 35), ...none }))!;
    expect(rec).toMatchObject({
      status: "shown",
      treatment: { n: 100, per_recipient: 10, purchasers: 40 },
      control: { n: 100, per_recipient: 5, purchasers: 35 },
      difference: 5,
      alpha: 0.05,
    });
    expect(rec.interval_low).toBeLessThan(5);
    expect(rec.interval_high).toBeGreaterThan(5);
    expect(rec.over_treated).toMatchObject({ n: 100, estimate: 500 });
    expect(Object.keys(rec).sort()).toEqual(["alpha", "control", "difference", "interval_high", "interval_low", "method", "over_treated", "significant", "status", "treatment"]);
  });

  it("holds the two means and no interval when there were too few purchases", () => {
    const rec = revenueRecord(revenueReadout({ treatment: arm(100, 10, 200, 40), control: arm(100, 5, 100, 12), ...none }))!;
    expect(rec.status).toBe("means_only");
    expect(rec).toMatchObject({ difference: 5, control: { purchasers: 12 } });
    expect(rec).not.toHaveProperty("interval_low");
  });
});
