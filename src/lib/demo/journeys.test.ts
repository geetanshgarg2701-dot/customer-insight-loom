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

  it("records the full path, with a Search detour before Product and a Support detour after Cart", () => {
    const rows = syntheticJourneys(40_000, 4);
    for (const row of rows) {
      expect(row.path[0]).toBe("Visit");
      // Remove the detours and what is left is exactly the main steps that were reached.
      const main = row.path.filter((step) => step !== "Search" && step !== "Support");
      expect(main).toEqual(row.steps.filter((x) => x !== null));
      const search = row.path.indexOf("Search");
      if (search >= 0) expect(row.path[search + 1]).toBe("Product");
      const support = row.path.indexOf("Support");
      if (support >= 0) expect(row.path[support - 1]).toBe("Cart");
    }
    expect(rows.some((r) => r.path.includes("Search"))).toBe(true);
    expect(rows.some((r) => r.path.includes("Support"))).toBe(true);
  });

  it("plants known effects: Search visitors reach the cart more, and Support callers buy less", () => {
    const rows = syntheticJourneys(120_000, 6);
    const toCart = (withSearch: boolean) => {
      const atProduct = rows.filter((r) => r.path.includes("Product") && r.path.includes("Search") === withSearch);
      return atProduct.filter((r) => r.path.includes("Cart")).length / atProduct.length;
    };
    expect(toCart(true)).toBeGreaterThan(toCart(false) + 0.05);
    const buys = (withSupport: boolean) => {
      const atCart = rows.filter((r) => r.path.includes("Cart") && r.path.includes("Support") === withSupport);
      return atCart.filter((r) => r.path.includes("Purchase")).length / atCart.length;
    };
    expect(buys(true)).toBeLessThan(buys(false) - 0.1);
  });

  it("uses only reserved synthetic labels, never an email or a name", () => {
    const rows = syntheticJourneys(200, 2);
    for (const r of rows) expect(JSON.stringify(r)).not.toMatch(/@|\d{3}-\d{4}/);
  });
});
