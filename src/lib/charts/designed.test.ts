import { describe, expect, it } from "vitest";
import { syntheticJourneys } from "../demo/journeys";
import type { PathCount } from "./anchored";
import {
  DESIGNED_JOURNEY,
  edgeCounts,
  stepStats,
  transitionsNotDesigned,
  wouldCreateCycle,
} from "./designed";

const P = (path: string, count: number): PathCount => ({ path: path.split(" > "), count });

describe("the designed journey", () => {
  const ids = DESIGNED_JOURNEY.nodes.map((n) => n.id);

  it("has unique steps, edges that join real steps, and a place for every step", () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of DESIGNED_JOURNEY.edges) {
      expect(ids, e.id).toContain(e.from);
      expect(ids, e.id).toContain(e.to);
      expect(e.id).toBe(`${e.from}>${e.to}`);
    }
    for (const n of DESIGNED_JOURNEY.nodes) {
      expect(Number.isFinite(n.x) && Number.isFinite(n.y), n.id).toBe(true);
    }
  });

  it("draws the main steps left to right in order, with each detour off the main row", () => {
    const x = (id: string) => DESIGNED_JOURNEY.nodes.find((n) => n.id === id)!.x;
    expect(x("Visit")).toBeLessThan(x("Product"));
    expect(x("Product")).toBeLessThan(x("Cart"));
    expect(x("Cart")).toBeLessThan(x("Purchase"));
    const y = (id: string) => DESIGNED_JOURNEY.nodes.find((n) => n.id === id)!.y;
    expect(y("Search")).not.toBe(y("Visit"));
    expect(y("Support")).not.toBe(y("Cart"));
  });

  it("has no loop in the design itself", () => {
    for (const e of DESIGNED_JOURNEY.edges) {
      const others = DESIGNED_JOURNEY.edges.filter((x) => x.id !== e.id);
      expect(wouldCreateCycle(others, e.from, e.to), e.id).toBe(false);
    }
  });
});

describe("stepStats on paths worked out by hand", () => {
  // 50 customers Visit, Product, Cart, Purchase. 20 Visit, Search, Product, Cart. 30 Visit, Product. 10 Visit only.
  const paths = [
    P("Visit > Product > Cart > Purchase", 50),
    P("Visit > Search > Product > Cart", 20),
    P("Visit > Product", 30),
    P("Visit", 10),
  ];
  const stats = stepStats(paths);

  it("counts each customer once per step, and splits who went on from who ended there", () => {
    expect(stats.get("Visit")).toMatchObject({ entered: 110, completed: 100, endedHere: 10 });
    expect(stats.get("Search")).toMatchObject({ entered: 20, completed: 20, endedHere: 0 });
    expect(stats.get("Product")).toMatchObject({ entered: 100, completed: 70, endedHere: 30 });
    expect(stats.get("Cart")).toMatchObject({ entered: 70, completed: 50, endedHere: 20 });
    expect(stats.get("Purchase")).toMatchObject({ entered: 50, completed: 0, endedHere: 50 });
  });

  it("always has entered equal to completed plus ended here", () => {
    for (const s of stats.values()) expect(s.entered).toBe(s.completed + s.endedHere);
  });

  it("gives each step's share of everyone who entered the journey", () => {
    expect(stats.get("Visit")!.share).toBe(1);
    expect(stats.get("Cart")!.share).toBeCloseTo(70 / 110, 12);
  });

  it("returns nothing for a step no one reached, so the screen can say so", () => {
    expect(stats.get("Refund")).toBeUndefined();
    expect(stepStats([]).size).toBe(0);
  });
});

describe("edgeCounts", () => {
  const paths = [P("Visit > Product > Cart > Purchase", 50), P("Visit > Search > Product > Cart", 20), P("Visit > Product", 30)];

  it("counts how many customers went directly from one step to the next", () => {
    const e = edgeCounts(paths);
    expect(e.get("Visit>Product")).toBe(80);
    expect(e.get("Visit>Search")).toBe(20);
    expect(e.get("Search>Product")).toBe(20);
    expect(e.get("Product>Cart")).toBe(70);
    expect(e.get("Cart>Purchase")).toBe(50);
    expect(e.get("Cart>Support")).toBeUndefined();
  });
});

describe("wouldCreateCycle", () => {
  const edges = [
    { from: "A", to: "B" },
    { from: "B", to: "C" },
    { from: "A", to: "D" },
  ];

  it("is true when the new connection closes a loop, directly or through other steps", () => {
    expect(wouldCreateCycle(edges, "C", "A")).toBe(true);
    expect(wouldCreateCycle(edges, "C", "B")).toBe(true);
    expect(wouldCreateCycle(edges, "B", "A")).toBe(true);
  });

  it("is true for a step connected to itself", () => {
    expect(wouldCreateCycle(edges, "A", "A")).toBe(true);
  });

  it("is false for a connection that only adds a branch or a shortcut forward", () => {
    expect(wouldCreateCycle(edges, "A", "C")).toBe(false);
    expect(wouldCreateCycle(edges, "D", "C")).toBe(false);
    expect(wouldCreateCycle(edges, "B", "D")).toBe(false);
  });

  it("works on an empty design and on steps it has not seen", () => {
    expect(wouldCreateCycle([], "A", "B")).toBe(false);
    expect(wouldCreateCycle(edges, "X", "Y")).toBe(false);
  });
});

describe("the design against the generator's real paths", () => {
  const generated = syntheticJourneys(30_000, 11);
  const counts = new Map<string, number>();
  for (const r of generated) counts.set(r.path.join(" > "), (counts.get(r.path.join(" > ")) ?? 0) + 1);
  const paths: PathCount[] = [...counts].map(([p, count]) => ({ path: p.split(" > "), count }));

  it("describes every transition customers really made, so nothing happens that the design does not show", () => {
    expect(transitionsNotDesigned(paths)).toEqual([]);
  });

  it("lists a transition the design lacks, when there is one", () => {
    expect(transitionsNotDesigned([...paths, P("Visit > Purchase", 5)])).toEqual(["Visit>Purchase"]);
  });

  it("matches a plain count for every step, and the outgoing edges add up to who went on", () => {
    const stats = stepStats(paths);
    const edges = edgeCounts(paths);
    for (const n of DESIGNED_JOURNEY.nodes) {
      const s = stats.get(n.id)!;
      expect(s.entered, n.id).toBe(generated.filter((r) => r.path.includes(n.id)).length);
      const out = DESIGNED_JOURNEY.edges.filter((e) => e.from === n.id).reduce((t, e) => t + (edges.get(e.id) ?? 0), 0);
      expect(out, `${n.id} outgoing edges`).toBe(s.completed);
    }
  });
});
