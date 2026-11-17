import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syntheticJourneys } from "../demo/journeys";
import type { SqlEngine } from "../intake/types";
import { createNodeEngine } from "../intake/testing/node-engine";
import {
  JOURNEY_DIMENSIONS,
  countsBy,
  loadJourneys,
  sankeyEdges,
  topPaths,
  whereClause,
  type Selection,
} from "./crossfilter";

const TABLE = "journeys";
let engine: SqlEngine;
const ROWS = 100_000;

beforeAll(async () => {
  engine = await createNodeEngine();
  await loadJourneys(engine, TABLE, syntheticJourneys(ROWS, 11));
}, 120_000);

afterAll(async () => {
  await engine.close?.();
});

describe("whereClause", () => {
  it("is empty with no selection", () => {
    expect(whereClause({})).toEqual({ sql: "", params: [] });
    expect(whereClause({ channel: [] })).toEqual({ sql: "", params: [] });
  });

  it("builds a parameterized filter, values never go into the SQL text", () => {
    const w = whereClause({ channel: ["ads", "email"], segment: ["new"] });
    expect(w.sql).toBe('WHERE "channel" IN (?, ?) AND "segment" IN (?)');
    expect(w.params).toEqual(["ads", "email", "new"]);
  });

  it("leaves out the chart's own dimension, so a chart still shows the choices it can switch to", () => {
    const w = whereClause({ channel: ["ads"], segment: ["new"] }, "channel");
    expect(w.sql).toBe('WHERE "segment" IN (?)');
  });

  it("refuses a dimension that is not on the allowed list, because the key becomes a column name", () => {
    expect(() => whereClause({ "channel; DROP TABLE journeys": ["x"] } as unknown as Selection)).toThrow(RangeError);
    expect(() => whereClause({}, "nope")).toThrow(RangeError);
  });
});

describe("countsBy", () => {
  it("counts every row once when nothing is selected", async () => {
    const counts = await countsBy(engine, TABLE, "channel", {});
    expect(counts.reduce((n, c) => n + c.count, 0)).toBe(ROWS);
    expect(counts.map((c) => c.value).sort()).toEqual(["ads", "email", "organic"]);
  });

  it("applies the other charts' selections and ignores its own", async () => {
    const all = await countsBy(engine, TABLE, "channel", {});
    const newOnly = await countsBy(engine, TABLE, "channel", { segment: ["new"] });
    expect(newOnly.reduce((n, c) => n + c.count, 0)).toBeLessThan(ROWS);
    // Selecting a channel does not shrink the channel chart itself.
    const own = await countsBy(engine, TABLE, "channel", { channel: ["ads"] });
    expect(own).toEqual(all);
  });

  it("treats a hostile value as plain text and matches nothing", async () => {
    const counts = await countsBy(engine, TABLE, "channel", { segment: ["x' OR '1'='1"] });
    expect(counts).toEqual([]);
    const still = await countsBy(engine, TABLE, "channel", {});
    expect(still.reduce((n, c) => n + c.count, 0)).toBe(ROWS);
  });

  it("rejects a dimension that is not allowed", async () => {
    await expect(countsBy(engine, TABLE, "email", {})).rejects.toThrow(RangeError);
  });
});

describe("sankeyEdges, plan test 8: inflow equals outflow plus drop off", () => {
  it("reconciles at every column, with no filter and with one", async () => {
    for (const selection of [{}, { segment: ["new"] }, { channel: ["ads"], segment: ["returning"] }] as Selection[]) {
      const edges = await sankeyEdges(engine, TABLE, selection);
      const inflow = new Map<string, number>();
      const outflow = new Map<string, number>();
      for (const e of edges) {
        inflow.set(e.target, (inflow.get(e.target) ?? 0) + e.value);
        outflow.set(e.source, (outflow.get(e.source) ?? 0) + e.value);
      }
      for (const [node, out] of outflow) {
        // Every node that has flow out of it, other than the first column, has the same flow into it.
        if (!node.startsWith("1. ")) expect(inflow.get(node), node).toBe(out);
      }
      // The first column holds everyone who matched the filter.
      const first = [...outflow].filter(([n]) => n.startsWith("1. ")).reduce((n, [, v]) => n + v, 0);
      // Counted by a dimension that no selection here touches, so every selection applies.
      const expected = (await countsBy(engine, TABLE, "reached", selection)).reduce((n, c) => n + c.count, 0);
      expect(first).toBe(expected);
    }
  });

  it("shows the planted drop off: new customers are lost at the cart more than returning ones", async () => {
    const share = async (segment: string) => {
      const edges = await sankeyEdges(engine, TABLE, { segment: [segment] });
      const intoCart = edges.filter((e) => e.target === "3. Cart").reduce((n, e) => n + e.value, 0);
      const lost = edges.filter((e) => e.source === "3. Cart" && e.target.startsWith("Dropped")).reduce((n, e) => n + e.value, 0);
      return lost / intoCart;
    };
    expect(await share("new")).toBeGreaterThan((await share("returning")) + 0.25);
  });
});

describe("speed on 100,000 rows, plan module M10 target of 1 second, a guess to be measured", () => {
  it("updates all three charts and the flow after a selection in well under 1 second", async () => {
    const selection: Selection = { channel: ["ads"], segment: ["new"] };
    const started = performance.now();
    await Promise.all([
      ...JOURNEY_DIMENSIONS.map((d) => countsBy(engine, TABLE, d, selection)),
      sankeyEdges(engine, TABLE, selection),
    ]);
    const ms = performance.now() - started;
    // Printed so the number is on record. Node and the browser build differ, so the browser is measured separately.
    console.log(`cross filter update on ${ROWS} rows in Node: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1000);
  });
});

describe("topPaths, plan test 9: path totals equal flow totals, except merged rare paths, which are labeled", () => {
  it("accounts for every customer once, with the rare paths merged and counted", async () => {
    const r = await topPaths(engine, TABLE, {}, { minShare: 0.02 });
    expect(r.total).toBe(ROWS);
    expect(r.paths.reduce((n, p) => n + p.count, 0) + r.other.count).toBe(ROWS);
    // Every kept path meets the threshold, and every merged one did not.
    for (const p of r.paths) expect(p.share).toBeGreaterThanOrEqual(0.02);
    expect(r.other.paths).toBeGreaterThan(0);
    expect(r.other.share).toBeCloseTo(r.other.count / ROWS, 10);
    expect(r.minShare).toBe(0.02);
    // Largest first.
    for (let i = 1; i < r.paths.length; i++) expect(r.paths[i].count).toBeLessThanOrEqual(r.paths[i - 1].count);
  });

  it("matches the flow: paths that end in Purchase equal the people flowing into Purchase", async () => {
    for (const selection of [{}, { segment: ["new"] }, { channel: ["ads"], segment: ["vip"] }] as Selection[]) {
      const flow = await sankeyEdges(engine, TABLE, selection);
      const purchased = flow.filter((e) => e.target === "4. Purchase").reduce((n, e) => n + e.value, 0);
      const r = await topPaths(engine, TABLE, selection, { minShare: 0 });
      expect(r.other.count).toBe(0);
      expect(r.paths.filter((p) => p.endsInPurchase).reduce((n, p) => n + p.count, 0)).toBe(purchased);
      const everyone = flow.filter((e) => e.source.startsWith("1. ")).reduce((n, e) => n + e.value, 0);
      expect(r.total).toBe(everyone);
    }
  });

  it("merges nothing at a threshold of zero, and merges more at a higher threshold", async () => {
    const none = await topPaths(engine, TABLE, {}, { minShare: 0 });
    const some = await topPaths(engine, TABLE, {}, { minShare: 0.02 });
    const more = await topPaths(engine, TABLE, {}, { minShare: 0.1 });
    expect(none.other).toEqual({ count: 0, share: 0, paths: 0 });
    expect(more.other.count).toBeGreaterThan(some.other.count);
  });

  it("shows the planted detour: a Search path exists among the top paths", async () => {
    const r = await topPaths(engine, TABLE, {}, { minShare: 0.01 });
    expect(r.paths.some((p) => p.path.includes("Search"))).toBe(true);
  });

  it("refuses a bad threshold and keeps hostile values as text", async () => {
    await expect(topPaths(engine, TABLE, {}, { minShare: -0.1 })).rejects.toThrow(RangeError);
    await expect(topPaths(engine, TABLE, {}, { minShare: 1.5 })).rejects.toThrow(RangeError);
    const r = await topPaths(engine, TABLE, { segment: ["x' OR '1'='1"] }, { minShare: 0 });
    expect(r.total).toBe(0);
    expect(r.paths).toEqual([]);
  });
});
