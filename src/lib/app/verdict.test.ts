import { describe, expect, it } from "vitest";
import { describeVerdict } from "./verdict";

describe("describeVerdict", () => {
  it("calls an interval that spans zero inconclusive and names both ends", () => {
    // The review case: 500 per arm, 60 conversions against 50, interval -1.90 to +5.91 points.
    const v = describeVerdict({ significant: false, lift: 0.02, interval: { low: -0.019, high: 0.0591 } });
    expect(v.label).toBe("Significant: no");
    expect(v.text).toMatch(/^Inconclusive/);
    expect(v.text).toContain("a loss of 1.90 points");
    expect(v.text).toContain("a gain of 5.91 points");
    expect(v.text).toMatch(/does not show .* no effect/);
  });

  it("explains a significant gain without the inconclusive wording", () => {
    const v = describeVerdict({ significant: true, lift: 0.025, interval: { low: 0.01, high: 0.04 } });
    expect(v.label).toBe("Significant: yes");
    expect(v.text).not.toMatch(/Inconclusive/);
    expect(v.text).toContain("excludes zero");
  });

  it("explains a significant loss", () => {
    const v = describeVerdict({ significant: true, lift: -0.025, interval: { low: -0.04, high: -0.01 } });
    expect(v.label).toBe("Significant: yes");
    expect(v.text).toContain("excludes zero");
  });

  it("says no change when an end sits at zero", () => {
    const v = describeVerdict({ significant: false, lift: 0.015, interval: { low: 0, high: 0.03 } });
    expect(v.text).toContain("no change");
    expect(v.text).toContain("a gain of 3.00 points");
  });

  it("uses no em dash and no parentheses", () => {
    for (const interval of [{ low: -0.02, high: 0.05 }, { low: 0.01, high: 0.04 }]) {
      const v = describeVerdict({ significant: interval.low > 0, lift: (interval.low + interval.high) / 2, interval });
      expect(v.text + v.label).not.toMatch(/[\u2014()]/);
    }
  });
});

describe("describeVerdict, a significant result that may run high (review finding R1-6)", () => {
  it("warns when the interval reaches below half of the lift, as in a small test", () => {
    // 5 percent baseline, 2,000 per arm, a read of +1.85 points whose interval starts near +0.3.
    const v = describeVerdict({ significant: true, lift: 0.0185, interval: { low: 0.003, high: 0.034 } });
    expect(v.label).toBe("Significant: yes");
    expect(v.text).toMatch(/run high/);
    expect(v.text).toMatch(/plan the next test/);
  });

  it("stays quiet when the interval is tight around the lift", () => {
    const v = describeVerdict({ significant: true, lift: 0.025, interval: { low: 0.02, high: 0.03 } });
    expect(v.text).not.toMatch(/run high/);
  });

  it("warns for a significant loss too, because the size is also overstated", () => {
    const v = describeVerdict({ significant: true, lift: -0.0185, interval: { low: -0.034, high: -0.003 } });
    expect(v.text).toMatch(/run high|overstate/);
  });

  it("never warns on an inconclusive result", () => {
    const v = describeVerdict({ significant: false, lift: 0.02, interval: { low: -0.019, high: 0.0591 } });
    expect(v.text).not.toMatch(/run high/);
  });
});
