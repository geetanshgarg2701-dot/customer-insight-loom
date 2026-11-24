import { describe, expect, it } from "vitest";
import { syntheticJourneys } from "../demo/journeys";
import { funnelPath, funnelSentence, heroFunnel } from "./hero-funnel";

describe("the home screen funnel", () => {
  it("counts the same customers the Journeys screen loads", () => {
    const rows = syntheticJourneys(100_000, 11);
    const reached = (name: string) => rows.filter((r) => r.path.includes(name)).length;
    expect(heroFunnel()).toEqual(["Visit", "Product", "Cart", "Purchase"].map((name) => ({ name, count: reached(name) })));
    expect(heroFunnel()[0].count).toBe(100_000);
  });

  it("draws each step as tall as its share of the first", () => {
    // Half of 200 is 100 down from the top, and a quarter is 150 down.
    const d = funnelPath([100, 50, 25], 300, 200);
    expect(d.startsWith("M0 200 L0 0 L70 0")).toBe(true);
    expect(d).toContain("130 100 L170 100");
    expect(d).toContain("230 150 L300 150");
    expect(d.endsWith("L300 200 Z")).toBe(true);
    expect(d).not.toMatch(/NaN|Infinity/);
  });

  it("draws nothing when there is nothing to show", () => {
    expect(funnelPath([], 300, 200)).toBe("");
    expect(funnelPath([0, 0], 300, 200)).toBe("");
  });

  it("says every count in one sentence and that they are made up", () => {
    expect(funnelSentence([{ name: "Visit", count: 1000 }, { name: "Cart", count: 400 }, { name: "Purchase", count: 90 }])).toBe(
      "Synthetic example. Of 1,000 made-up customers, 400 reached Cart and 90 reached Purchase.",
    );
  });
});
