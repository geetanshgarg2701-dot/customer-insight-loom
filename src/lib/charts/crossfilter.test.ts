import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syntheticJourneys } from "../demo/journeys";
import type { SqlEngine } from "../intake/types";
import { createNodeEngine } from "../intake/testing/node-engine";
import {
  JOURNEY_DIMENSIONS,
  countsBy,
  loadJourneys,
  sankeyEdges,
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
