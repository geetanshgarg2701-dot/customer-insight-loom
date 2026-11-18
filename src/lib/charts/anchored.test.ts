import { describe, expect, it } from "vitest";
import { anchorChoices, anchoredFlow, type PathCount } from "./anchored";
import { syntheticJourneys } from "../demo/journeys";
import { mulberry32 } from "../stats/honesty";

const P = (path: string, count: number): PathCount => ({ path: path.split(" > "), count });

const SAMPLE: PathCount[] = [
  P("Visit > Product > Cart > Purchase", 50),
  P("Visit > Search > Product > Cart > Purchase", 20),
  P("Visit > Product > Cart > Support > Purchase", 10),
  P("Visit > Product > Cart", 15),
  P("Visit > Product", 40),
  P("Visit", 30),
];

const edge = (f: ReturnType<typeof anchoredFlow>, source: string, target: string) =>
  f.edges.find((e) => e.source === source && e.target === target)?.value;

describe("anchoredFlow, one anchor event", () => {
  const f = anchoredFlow(SAMPLE, { anchor: "Cart", before: 2, after: 2, topN: 3 });

  it("counts each customer who did the anchor once, and says how many were left out", () => {
    expect(f.customers).toBe(95);
    expect(f.outOf).toBe(165);
  });

  it("shows what happened next, with the end of the path as its own node", () => {
    expect(edge(f, "Anchor Cart", "+1 Purchase")).toBe(70);
    expect(edge(f, "Anchor Cart", "+1 Support")).toBe(10);
    expect(edge(f, "Anchor Cart", "Ended after anchor")).toBe(15);
    expect(edge(f, "+1 Support", "+2 Purchase")).toBe(10);
    expect(edge(f, "+1 Purchase", "Ended after +1")).toBe(70);
  });

  it("shows what happened before, and where a path began", () => {
    expect(edge(f, "-1 Product", "Anchor Cart")).toBe(95);
    expect(edge(f, "-2 Visit", "-1 Product")).toBe(75);
    expect(edge(f, "-2 Search", "-1 Product")).toBe(20);
  });

  it("marks a path that began at the anchor instead of dropping it", () => {
    const g = anchoredFlow([P("Cart > Purchase", 5), P("Visit > Cart", 3)], { anchor: "Cart", before: 1, after: 1, topN: 3 });
    expect(edge(g, "Began at anchor", "Anchor Cart")).toBe(5);
    expect(edge(g, "-1 Visit", "Anchor Cart")).toBe(3);
  });
});

describe("anchoredFlow, top N and the rest", () => {
  const paths = ["A", "B", "C", "D", "E"].map((e, i) => P(`Start > ${e}`, 10 - i));

  it("shows the top N events and groups the rest in one node that says how many kinds", () => {
    const f = anchoredFlow(paths, { anchor: "Start", before: 0, after: 1, topN: 2 });
    expect(edge(f, "Anchor Start", "+1 A")).toBe(10);
    expect(edge(f, "Anchor Start", "+1 B")).toBe(9);
    expect(edge(f, "Anchor Start", "+1 Other events")).toBe(8 + 7 + 6);
    const col = f.columns.find((c) => c.offset === 1)!;
    expect(col.other).toEqual({ count: 21, kinds: 3 });
    expect(col.events.map((e) => e.name)).toEqual(["A", "B"]);
  });

  it("shows every event when asked for all", () => {
    const f = anchoredFlow(paths, { anchor: "Start", before: 0, after: 1, topN: Infinity });
    const col = f.columns.find((c) => c.offset === 1)!;
    expect(col.events).toHaveLength(5);
    expect(col.other).toEqual({ count: 0, kinds: 0 });
  });

  it("breaks a tie by name, so the same data draws the same chart", () => {
    const f = anchoredFlow([P("S > B", 4), P("S > A", 4), P("S > C", 4)], { anchor: "S", before: 0, after: 1, topN: 2 });
    expect(f.columns.find((c) => c.offset === 1)!.events.map((e) => e.name)).toEqual(["A", "B"]);
  });
});

describe("anchoredFlow, rules", () => {
  it("returns an empty flow for an anchor nobody did", () => {
    const f = anchoredFlow(SAMPLE, { anchor: "Refund", before: 1, after: 1, topN: 3 });
    expect(f.customers).toBe(0);
    expect(f.edges).toEqual([]);
  });

  it("refuses a bad number of steps or a bad top N instead of guessing", () => {
    const base = { anchor: "Cart", before: 1, after: 1, topN: 3 };
    expect(() => anchoredFlow(SAMPLE, { ...base, after: -1 })).toThrow(RangeError);
    expect(() => anchoredFlow(SAMPLE, { ...base, before: 1.5 })).toThrow(RangeError);
    expect(() => anchoredFlow(SAMPLE, { ...base, after: 9 })).toThrow(RangeError);
    expect(() => anchoredFlow(SAMPLE, { ...base, topN: 0 })).toThrow(RangeError);
  });

  it("lists the events a person can anchor on, with how many customers did each, most first", () => {
    const choices = anchorChoices(SAMPLE);
    expect(choices[0]).toEqual({ event: "Visit", customers: 165 });
    expect(choices.find((c) => c.event === "Search")).toEqual({ event: "Search", customers: 20 });
    expect(choices.find((c) => c.event === "Support")).toEqual({ event: "Support", customers: 10 });
  });

  it("counts a customer once even when the anchor repeats, from the first time", () => {
    const f = anchoredFlow([P("A > B > A > C", 7)], { anchor: "A", before: 0, after: 2, topN: 3 });
    expect(f.customers).toBe(7);
    expect(edge(f, "Anchor A", "+1 B")).toBe(7);
    expect(edge(f, "+1 B", "+2 A")).toBe(7);
  });
});

describe("anchoredFlow, properties on random paths", () => {
  const rng = mulberry32(20261119);
  const EVENTS = ["a", "b", "c", "d", "e", "f", "g"];
  const randomPaths = (): PathCount[] =>
    Array.from({ length: 1 + Math.floor(rng() * 25) }, () => ({
      path: Array.from({ length: 1 + Math.floor(rng() * 6) }, () => EVENTS[Math.floor(rng() * EVENTS.length)]),
      count: 1 + Math.floor(rng() * 50),
    }));

  it("keeps every column's inflow equal to its outflow plus its drop off, and loses no customer", () => {
    for (let n = 0; n < 300; n++) {
      const paths = randomPaths();
      const options = {
        anchor: EVENTS[Math.floor(rng() * EVENTS.length)],
        before: Math.floor(rng() * 4),
        after: Math.floor(rng() * 4),
        topN: 1 + Math.floor(rng() * 4),
      };
      const f = anchoredFlow(paths, options);
      const expected = paths
        .filter((p) => p.path.includes(options.anchor))
        .reduce((s, p) => s + p.count, 0);
      expect(f.customers).toBe(expected);
      if (expected === 0) continue;

      const inflow = new Map<string, number>();
      const outflow = new Map<string, number>();
      for (const e of f.edges) {
        outflow.set(e.source, (outflow.get(e.source) ?? 0) + e.value);
        inflow.set(e.target, (inflow.get(e.target) ?? 0) + e.value);
      }
      for (const node of f.nodes) {
        const inn = inflow.get(node.name) ?? 0;
        const out = outflow.get(node.name) ?? 0;
        // Left edge nodes have no inflow and right edge nodes have no outflow, because the chart stops there.
        if (node.depth > 0 && node.depth < f.before + f.after) {
          if (node.kind === "event" || node.kind === "other") expect(inn, node.name).toBe(out);
        }
        if (node.depth === f.before && f.edges.length > 0) expect(inn === 0 ? out : inn, node.name).toBe(node.count);
      }
      // Every column's named events plus the group are exactly the customers present there.
      for (const c of f.columns) {
        expect(c.events.reduce((s, e) => s + e.count, 0) + c.other.count).toBe(c.present);
        expect(c.events.length).toBeLessThanOrEqual(options.topN);
      }
      expect(f.columns.find((c) => c.offset === 0)!.present).toBe(expected);
    }
  });
});

describe("anchoredFlow on the synthetic journeys, plan section 5.14", () => {
  const rows = syntheticJourneys(20_000, 11);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.path.join(" > "), (counts.get(r.path.join(" > ")) ?? 0) + 1);
  const paths: PathCount[] = [...counts].map(([p, count]) => ({ path: p.split(" > "), count }));

  it("finds the planted Search detour, and the planted Support drop in buying", () => {
    const f = anchoredFlow(paths, { anchor: "Cart", before: 0, after: 1, topN: 5 });
    const direct = (needle: (p: string[]) => boolean) => rows.filter((r) => needle(r.path)).length;
    expect(f.customers).toBe(direct((p) => p.includes("Cart")));
    expect(edge(f, "Anchor Cart", "+1 Support")).toBe(direct((p) => p[p.indexOf("Cart") + 1] === "Support"));
    expect(edge(f, "Anchor Cart", "+1 Purchase")).toBe(direct((p) => p[p.indexOf("Cart") + 1] === "Purchase"));
    // Of those who contact Support after the cart, fewer buy than of those who go straight on: the planted effect.
    const afterSupport = anchoredFlow(paths, { anchor: "Support", before: 0, after: 1, topN: 5 });
    const supportBuy = (edge(afterSupport, "Anchor Support", "+1 Purchase") ?? 0) / afterSupport.customers;
    const directBuy = (edge(f, "Anchor Cart", "+1 Purchase") ?? 0) / f.customers;
    expect(supportBuy).toBeLessThan(directBuy);
  });
});
