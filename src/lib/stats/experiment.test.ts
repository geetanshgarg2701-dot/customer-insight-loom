import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNodeEngine } from "../intake/testing/node-engine";
import type { SqlEngine } from "../intake/types";
import { armCounts, experimentReadout } from "./experiment";
import { newcombeDifference } from "./readout";

let engine: SqlEngine;

beforeEach(async () => {
  engine = await createNodeEngine();
});

afterEach(async () => {
  await engine.exec("DROP TABLE IF EXISTS exp_rows");
  await engine.close?.();
});

/** Rows 0 to total minus 1. The first `treated` rows are treatment. */
async function makeTable(total: number, treated: number, convertedRule: string) {
  await engine.exec(
    `CREATE OR REPLACE TABLE exp_rows AS SELECT ` +
      `CASE WHEN i < ${treated} THEN 'treatment' ELSE 'control' END AS arm, ` +
      `${convertedRule} AS converted FROM range(${total}) t(i)`,
  );
}

describe("armCounts, computed in DuckDB", () => {
  it("counts assigned, closed, converted and pending people per arm", async () => {
    // Every 100th person has an open window, shown as NULL. Every i with i % 10 = 1 converted.
    await makeTable(10_000, 6_000, "CASE WHEN i % 100 = 0 THEN NULL ELSE i % 10 = 1 END");
    const c = await armCounts(engine, "exp_rows");
    expect(c.treatment).toEqual({ assigned: 6000, n: 5940, conversions: 600, pending: 60 });
    expect(c.control).toEqual({ assigned: 4000, n: 3960, conversions: 400, pending: 40 });
  });

  it("returns zero counts for an arm with no rows", async () => {
    await makeTable(100, 100, "true");
    const c = await armCounts(engine, "exp_rows");
    expect(c.control).toEqual({ assigned: 0, n: 0, conversions: 0, pending: 0 });
  });

  it("rejects an unknown arm label instead of ignoring it", async () => {
    await engine.exec(
      "CREATE OR REPLACE TABLE exp_rows AS SELECT * FROM (VALUES ('treatment', true), ('Control', false)) v(arm, converted)",
    );
    await expect(armCounts(engine, "exp_rows")).rejects.toThrow(/arm/i);
  });

  it("rejects a NULL arm", async () => {
    await engine.exec(
      "CREATE OR REPLACE TABLE exp_rows AS SELECT * FROM (VALUES ('treatment', true), (NULL, false)) v(arm, converted)",
    );
    await expect(armCounts(engine, "exp_rows")).rejects.toThrow(/arm/i);
  });

  it("only accepts a plain table name", async () => {
    await expect(armCounts(engine, "exp_rows; DROP TABLE x")).rejects.toThrow(RangeError);
    await expect(armCounts(engine, "Exp Rows")).rejects.toThrow(RangeError);
  });
});

describe("experimentReadout", () => {
  it("reads out a balanced experiment from the SQL counts", async () => {
    // Treatment converts at 12 percent, control at 10 percent.
    await makeTable(
      10_000,
      5_000,
      "CASE WHEN i < 5000 THEN i % 100 < 12 ELSE i % 100 < 10 END",
    );
    const r = await experimentReadout(engine, "exp_rows", { treatmentShare: 0.5 });
    expect(r.status).toBe("readable");
    if (r.status !== "readable") return;
    expect(r.srm.pass).toBe(true);
    expect(r.readout.lift).toBeCloseTo(0.02, 14);
    const ci = newcombeDifference(600, 5000, 500, 5000, 0.05);
    expect(r.readout.interval.low).toBeCloseTo(ci.low, 14);
    expect(r.readout.interval.high).toBeCloseTo(ci.high, 14);
  });

  it("blocks the readout on a sample ratio mismatch", async () => {
    await makeTable(10_000, 5_250, "i % 10 = 0");
    const r = await experimentReadout(engine, "exp_rows", { treatmentShare: 0.5 });
    expect(r.status).toBe("blocked_srm");
    expect(r.srm.pass).toBe(false);
    expect("readout" in r).toBe(false);
    expect(r.message).toMatch(/data problem/i);
  });

  it("runs the mismatch check on everyone assigned, including open windows", async () => {
    // 5,250 vs 4,750 assigned, but the extra treatment people all have open windows.
    await makeTable(10_000, 5_250, "CASE WHEN i >= 5000 AND i < 5250 THEN NULL ELSE i % 10 = 0 END");
    const r = await experimentReadout(engine, "exp_rows", { treatmentShare: 0.5 });
    expect(r.status).toBe("blocked_srm");
  });

  it("waits when an arm has no closed windows yet", async () => {
    await makeTable(1_000, 500, "CASE WHEN i < 500 THEN NULL ELSE false END");
    const r = await experimentReadout(engine, "exp_rows", { treatmentShare: 0.5 });
    expect(r.status).toBe("waiting");
    expect(r.counts.treatment.pending).toBe(500);
  });
});
