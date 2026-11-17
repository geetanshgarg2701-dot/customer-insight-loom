import { describe, expect, it } from "vitest";
import { powerCheck } from "./power";

describe("powerCheck", () => {
  it("matches the standard two proportion sample size for an even split", () => {
    // 10 percent baseline, 2 point absolute lift, alpha 0.05 two sided, power 0.80:
    // 3,841 per arm by the normal approximation without continuity correction.
    const r = powerCheck({ baselineRate: 0.1, minDetectableLift: 0.02, treatmentShare: 0.5, audienceSize: 10_000 });
    expect(r.requiredTreatment).toBe(3841);
    expect(r.requiredControl).toBe(3841);
    expect(r.availableTreatment).toBe(5000);
    expect(r.availableControl).toBe(5000);
    expect(r.pass).toBe(true);
    expect(r.alpha).toBe(0.05);
    expect(r.power).toBe(0.8);
    expect(r.method).toMatch(/two proportion/i);
  });

  it("lands close to the plan's rule of thumb of 16 p times 1 minus p over d squared", () => {
    const r = powerCheck({ baselineRate: 0.1, minDetectableLift: 0.02, treatmentShare: 0.5, audienceSize: 1 });
    const ruleOfThumb = (16 * 0.1 * 0.9) / 0.02 ** 2;
    expect(r.requiredTreatment / ruleOfThumb).toBeGreaterThan(1);
    expect(r.requiredTreatment / ruleOfThumb).toBeLessThan(1.1);
  });

  it("fails when the audience is too small", () => {
    const r = powerCheck({ baselineRate: 0.1, minDetectableLift: 0.02, treatmentShare: 0.5, audienceSize: 7_000 });
    expect(r.pass).toBe(false);
  });

  it("needs a larger audience for an uneven split", () => {
    const even = powerCheck({ baselineRate: 0.05, minDetectableLift: 0.01, treatmentShare: 0.5, audienceSize: 1 });
    const holdout = powerCheck({ baselineRate: 0.05, minDetectableLift: 0.01, treatmentShare: 0.9, audienceSize: 1 });
    expect(holdout.requiredTotal).toBeGreaterThan(even.requiredTotal);
    // With a 10 percent holdout, the control arm is the small one.
    expect(holdout.requiredControl).toBeLessThan(holdout.requiredTreatment);
  });

  it("splits the available audience by the treatment share", () => {
    const r = powerCheck({ baselineRate: 0.05, minDetectableLift: 0.01, treatmentShare: 0.9, audienceSize: 1001 });
    expect(r.availableTreatment + r.availableControl).toBe(1001);
    expect(r.availableTreatment).toBe(900);
  });

  it("asks for more people at higher power", () => {
    const p80 = powerCheck({ baselineRate: 0.1, minDetectableLift: 0.02, treatmentShare: 0.5, audienceSize: 1 });
    const p90 = powerCheck({ baselineRate: 0.1, minDetectableLift: 0.02, treatmentShare: 0.5, audienceSize: 1, power: 0.9 });
    expect(p90.requiredTotal).toBeGreaterThan(p80.requiredTotal);
  });

  it("rejects inputs that cannot describe a test", () => {
    const base = { baselineRate: 0.1, minDetectableLift: 0.02, treatmentShare: 0.5, audienceSize: 100 };
    const bad = [
      { ...base, baselineRate: 0 },
      { ...base, baselineRate: 1 },
      { ...base, minDetectableLift: 0 },
      { ...base, minDetectableLift: 0.95 },
      { ...base, treatmentShare: 0 },
      { ...base, treatmentShare: 1 },
      { ...base, audienceSize: -1 },
      { ...base, alpha: 0 },
      { ...base, power: 1 },
    ];
    for (const input of bad) expect(() => powerCheck(input)).toThrow(RangeError);
  });
});

describe("smallestDetectableLift", () => {
  const smallest = (audienceSize: number, treatmentShare = 0.5) =>
    powerCheck({ baselineRate: 0.1, minDetectableLift: 0.08, treatmentShare, audienceSize }).smallestDetectableLift;

  it("matches the review figures for a 10 percent baseline and an even split", () => {
    // 300 per arm, 500 per arm and 1,000 per arm, alpha 0.05, power 0.80.
    expect(smallest(600)!).toBeCloseTo(0.079, 3);
    expect(smallest(1000)!).toBeCloseTo(0.0595, 3);
    expect(smallest(2000)!).toBeCloseTo(0.0407, 3);
  });

  it("is the edge of passing: that lift passes with this audience, a slightly smaller one fails", () => {
    const d = smallest(600)!;
    const atEdge = powerCheck({ baselineRate: 0.1, minDetectableLift: d, treatmentShare: 0.5, audienceSize: 600 });
    const below = powerCheck({ baselineRate: 0.1, minDetectableLift: d - 0.0005, treatmentShare: 0.5, audienceSize: 600 });
    expect(atEdge.pass).toBe(true);
    expect(below.pass).toBe(false);
  });

  it("shrinks as the audience grows", () => {
    expect(smallest(4000)!).toBeLessThan(smallest(1000)!);
    expect(smallest(1000)!).toBeLessThan(smallest(300)!);
  });

  it("is larger for an uneven split with the same audience", () => {
    expect(smallest(1000, 0.9)!).toBeGreaterThan(smallest(1000, 0.5)!);
  });

  it("is null when no lift could be detected with this audience", () => {
    expect(smallest(0)).toBeNull();
    expect(smallest(4)).toBeNull();
  });
});
