import { describe, expect, it } from "vitest";
import { assembleChain, THEME_IDS } from "./evidence";
import { CHAIN_NODE, chainGraph } from "./chain-graph";

const empty = { comparisons: 0, q: 0.05, links: [] };
const steps = assembleChain("shipping_cost", [], empty, [], [
  { id: "e1", title: "Free shipping test", themeId: THEME_IDS.shipping_cost, status: "running" },
]);

describe("chainGraph", () => {
  it("makes one node per link, in chain order, with the same text the list shows", () => {
    const g = chainGraph(steps);
    expect(g.nodes.map((n) => n.id)).toEqual(["theme", "segment", "path", "revenue", "test", "decision"]);
    g.nodes.forEach((n, i) => {
      expect(n.label).toBe(steps[i].label);
      expect(n.text).toBe(steps[i].text);
      expect(n.missing).toBe(steps[i].status === "missing");
      expect(n.ariaLabel).toBe(`${i + 1} of 6. ${steps[i].label}. ${steps[i].status === "missing" ? "Missing. " : ""}${steps[i].text}`);
    });
    expect(g.nodes.find((n) => n.id === "test")!.entryId).toBe("e1");
  });

  it("joins each link to the next with five edges", () => {
    const g = chainGraph(steps);
    expect(g.edges.map((e) => `${e.source}>${e.target}`)).toEqual([
      "theme>segment",
      "segment>path",
      "path>revenue",
      "revenue>test",
      "test>decision",
    ]);
  });

  it("lays the links out in two rows of three, reading left to right and then the second row, with no overlap", () => {
    const g = chainGraph(steps);
    const rows = [...new Set(g.nodes.map((n) => n.y))];
    expect(rows).toHaveLength(2);
    expect(g.nodes.slice(0, 3).every((n) => n.y === rows[0])).toBe(true);
    expect(g.nodes.slice(3).every((n) => n.y === rows[1])).toBe(true);
    for (const row of [g.nodes.slice(0, 3), g.nodes.slice(3)]) {
      for (let i = 1; i < row.length; i++) expect(row[i].x).toBeGreaterThanOrEqual(row[i - 1].x + CHAIN_NODE.width);
    }
    expect(rows[1]).toBeGreaterThanOrEqual(rows[0] + CHAIN_NODE.height);
  });

  it("refuses a chain that is not the six links in order", () => {
    expect(() => chainGraph(steps.slice(1))).toThrow(RangeError);
    expect(() => chainGraph([steps[1], steps[0], ...steps.slice(2)])).toThrow(RangeError);
  });
});
