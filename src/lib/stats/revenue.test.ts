import { describe, expect, it } from "vitest";
import { studentTQuantile } from "./distributions";
import { MIN_PURCHASES, revenueReadout, type ArmMoney, type RevenueInput } from "./revenue";

/** Stats for an arm of n people whose revenue per person has the given mean and sample variance. */
function arm(n: number, mean: number, variance: number, purchasers: number): ArmMoney {
  return { n, sum: n * mean, variance, purchasers };
}
const base = (over: Partial<RevenueInput> = {}): RevenueInput => ({
  treatment: arm(100, 10, 200, 40),
  control: arm(100, 5, 100, 35),
  unreportedConverters: 0,
  invalidValues: 0,
  ignoredOnNonConverters: 0,
  ...over,
});

describe("revenue per recipient, worked out by hand", () => {
  // Treatment: 100 people, mean 10 dollars, variance 200. Control: 100 people, mean 5, variance 100.
  // Difference 5. Standard error = sqrt(200/100 + 100/100) = sqrt(3) = 1.7320508.
  // Welch degrees of freedom = 3^2 / ((2^2)/99 + (1^2)/99) = 9 / (5/99) = 178.2.
  const r = revenueReadout(base());

  it("shows each group's revenue per recipient and the difference", () => {
    expect(r.status).toBe("shown");
    if (r.status !== "shown") return;
    expect(r.treatment).toMatchObject({ n: 100, purchasers: 40 });
    expect(r.treatment.perRecipient).toBeCloseTo(10, 10);
    expect(r.control.perRecipient).toBeCloseTo(5, 10);
    expect(r.difference).toBeCloseTo(5, 10);
  });

  it("gives a Welch interval with the t quantile at the Welch degrees of freedom", () => {
    if (r.status !== "shown") throw new Error("expected shown");
    expect(r.df).toBeCloseTo(178.2, 6);
    const half = studentTQuantile(0.975, 178.2) * Math.sqrt(3);
    expect(r.low).toBeCloseTo(5 - half, 8);
    expect(r.high).toBeCloseTo(5 + half, 8);
    expect(r.significant).toBe(true);
  });

  it("scales the difference by the treated group, as a range, and says what it is", () => {
    if (r.status !== "shown") throw new Error("expected shown");
    expect(r.overTreated.n).toBe(100);
    expect(r.overTreated.estimate).toBeCloseTo(500, 8);
    expect(r.overTreated.low).toBeCloseTo(100 * r.low, 8);
    expect(r.overTreated.high).toBeCloseTo(100 * r.high, 8);
  });

  it("is not significant when the interval holds zero", () => {
    const wide = revenueReadout(base({ treatment: arm(100, 10, 4000, 40), control: arm(100, 9, 4000, 35) }));
    expect(wide.status).toBe("shown");
    if (wide.status === "shown") {
      expect(wide.low).toBeLessThan(0);
      expect(wide.high).toBeGreaterThan(0);
      expect(wide.significant).toBe(false);
    }
  });

  it("reads a different alpha", () => {
    const a99 = revenueReadout(base({ alpha: 0.01 }));
    if (r.status !== "shown" || a99.status !== "shown") throw new Error("expected shown");
    expect(a99.high - a99.low).toBeGreaterThan(r.high - r.low);
  });
});

describe("the case the plan warns about: more orders, smaller orders, less revenue", () => {
  // Control converts at 10 percent with 50 dollar orders, treatment at 12 percent with 40 dollar orders after a discount.
  // Revenue per recipient is 5.00 against 4.80, so the discount lost money even though conversion rose.
  // Per person revenue is 50 or 0 in control and 40 or 0 in treatment, so the variance is p(1-p) times the order squared.
  const trt = (n: number): ArmMoney => ({ n, sum: n * 0.12 * 40, variance: 40 * 40 * 0.12 * 0.88, purchasers: Math.round(n * 0.12) });
  const ctl = (n: number): ArmMoney => ({ n, sum: n * 0.1 * 50, variance: 50 * 50 * 0.1 * 0.9, purchasers: Math.round(n * 0.1) });

  it("reports the revenue difference with the right sign, where lift times order value would not", () => {
    const r = revenueReadout({ treatment: trt(10_000), control: ctl(10_000), unreportedConverters: 0, invalidValues: 0, ignoredOnNonConverters: 0 });
    expect(r.status).toBe("shown");
    if (r.status !== "shown") return;
    expect(r.treatment.perRecipient).toBeCloseTo(4.8, 10);
    expect(r.control.perRecipient).toBeCloseTo(5.0, 10);
    expect(r.difference).toBeCloseTo(-0.2, 10);
    // Over the 10,000 treated people that is a loss of about 2,000 dollars, the figure in the plan.
    expect(r.overTreated.estimate).toBeCloseTo(-2000, 6);
  });
});

describe("when revenue is not shown", () => {
  it("is not shown when someone who converted has no revenue value, and says how many", () => {
    const r = revenueReadout(base({ unreportedConverters: 7 }));
    expect(r.status).toBe("not_shown");
    if (r.status !== "not_shown") return;
    expect(r.reason).toBe("unreported_converters");
    expect(r.text).toContain("7 people who converted have no revenue value");
  });

  it("is not shown when a group has fewer than two people", () => {
    const r = revenueReadout(base({ control: arm(1, 5, 0, 1) }));
    expect(r).toMatchObject({ status: "not_shown", reason: "too_few_people" });
  });

  it("shows the means but no interval when a group has fewer than 30 purchases", () => {
    expect(MIN_PURCHASES).toBe(30);
    const r = revenueReadout(base({ control: arm(100, 5, 100, MIN_PURCHASES - 1) }));
    expect(r.status).toBe("means_only");
    if (r.status !== "means_only") return;
    expect(r.difference).toBeCloseTo(5, 10);
    expect(r.text).toMatch(/at least 30 purchases/);
    expect(r).not.toHaveProperty("low");
    expect(revenueReadout(base({ control: arm(100, 5, 100, MIN_PURCHASES) })).status).toBe("shown");
  });

  it("puts the file's problems in notes, never in the numbers", () => {
    const r = revenueReadout(base({ invalidValues: 3, ignoredOnNonConverters: 2 }));
    expect(r.status).toBe("shown");
    expect(r.notes.join(" ")).toContain("3 revenue values were not plain numbers");
    expect(r.notes.join(" ")).toContain("2 people marked as not converted had a revenue value, which was ignored");
  });

  it("handles groups with no spread at all", () => {
    const r = revenueReadout({ treatment: arm(100, 10, 0, 40), control: arm(100, 5, 0, 35), unreportedConverters: 0, invalidValues: 0, ignoredOnNonConverters: 0 });
    expect(r.status).toBe("shown");
    if (r.status !== "shown") return;
    expect(r.low).toBeCloseTo(5, 10);
    expect(r.high).toBeCloseTo(5, 10);
    expect(r.significant).toBe(true);
  });

  it("has a plain method note that names the test and the assumption it makes", () => {
    if (revenueReadout(base()).status !== "shown") throw new Error("expected shown");
    const r = revenueReadout(base());
    if (r.status !== "shown") return;
    expect(r.method).toMatch(/Welch/);
    expect(r.method).toMatch(/revenue per recipient/i);
    expect(r.method).toMatch(/lopsided|skew/i);
  });
});
