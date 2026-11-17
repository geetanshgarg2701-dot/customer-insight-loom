import { describe, expect, it } from "vitest";
import { JOURNEY_STEPS, syntheticJourneys } from "./journeys";

describe("syntheticJourneys", () => {
  it("is identical for the same seed and different for another", () => {
    expect(syntheticJourneys(500, 7)).toEqual(syntheticJourneys(500, 7));
    expect(syntheticJourneys(500, 7)).not.toEqual(syntheticJourneys(500, 8));
  });

  it("starts everyone at the first step and records only steps that were reached in order", () => {
    for (const row of syntheticJourneys(2000, 1)) {
      expect(row.steps[0]).toBe(JOURNEY_STEPS[0]);
      const reached = row.steps.filter((s) => s !== null);
      expect(reached).toEqual(JOURNEY_STEPS.slice(0, reached.length));
      // Once a step is missing, every later step is missing too.
      const firstGap = row.steps.indexOf(null);
      if (firstGap >= 0) expect(row.steps.slice(firstGap).every((s) => s === null)).toBe(true);
      expect(row.reached).toBe(reached[reached.length - 1]);
    }
  });

  it("plants a known fact: new customers drop off at the cart much more than returning ones", () => {
    const rows = syntheticJourneys(60_000, 3);
    const rate = (segment: string) => {
      const atCart = rows.filter((r) => r.segment === segment && r.steps[2] !== null);
      return atCart.filter((r) => r.steps[3] === null).length / atCart.length;
    };
    expect(rate("new")).toBeGreaterThan(0.65);
    expect(rate("returning")).toBeLessThan(0.5);
    expect(rate("new") - rate("returning")).toBeGreaterThan(0.25);
  });

  it("uses only reserved synthetic labels, never an email or a name", () => {
    const rows = syntheticJourneys(200, 2);
    for (const r of rows) expect(JSON.stringify(r)).not.toMatch(/@|\d{3}-\d{4}/);
  });
});
