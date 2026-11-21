import { describe, expect, it } from "vitest";
import { syntheticJourneys } from "../demo/journeys";
import { journeyTiles } from "./tiles";

describe("journey tiles", () => {
  it("works out the tiles from path counts, by hand", () => {
    const t = journeyTiles([
      { path: ["Visit", "Product", "Cart", "Purchase"], count: 30 },
      { path: ["Visit", "Search", "Product"], count: 20 },
      { path: ["Visit", "Product", "Cart", "Support"], count: 10 },
      { path: ["Visit"], count: 40 },
    ]);
    expect(t).toEqual({ customers: 100, bought: 0.3, detoured: 0.3, topExit: { step: "Visit", count: 40 } });
  });

  it("does not count someone who bought as leaving, and breaks a tie by name", () => {
    const t = journeyTiles([
      { path: ["Visit", "Purchase"], count: 50 },
      { path: ["Visit", "Product"], count: 5 },
      { path: ["Visit", "Cart"], count: 5 },
    ]);
    expect(t.topExit).toEqual({ step: "Cart", count: 5 });
  });

  it("gives no shares when nobody is selected", () => {
    expect(journeyTiles([])).toEqual({ customers: 0, bought: null, detoured: null, topExit: null });
  });

  it("matches a count made straight from the generated customers", () => {
    const rows = syntheticJourneys(20_000, 11);
    const counts = new Map<string, { path: string[]; count: number }>();
    for (const r of rows) {
      const k = r.path.join(">");
      const c = counts.get(k) ?? { path: r.path, count: 0 };
      c.count++;
      counts.set(k, c);
    }
    const t = journeyTiles([...counts.values()]);
    expect(t.customers).toBe(20_000);
    expect(t.bought).toBe(rows.filter((r) => r.path.includes("Purchase")).length / 20_000);
    expect(t.detoured).toBe(rows.filter((r) => r.path.includes("Search") || r.path.includes("Support")).length / 20_000);
  });
});
