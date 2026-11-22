import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNodeEngine } from "../intake/testing/node-engine";
import type { SqlEngine } from "../intake/types";
import { createLedger, dropLedgerTables, type Ledger } from "../ledger/ledger";
import { assignAudience, verifyResults } from "./assign";

function pinned() {
  let counter = 0;
  return {
    newId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
    randomBytes: (n: number) => new Uint8Array(n).fill(9),
  };
}

describe("revenue through the results upload", () => {
  let engine: SqlEngine;
  let ledger: Ledger;
  let entryId: string;
  let assigned: { email: string; arm: "treatment" | "control" }[];

  beforeEach(async () => {
    engine = await createNodeEngine();
    await dropLedgerTables(engine);
    await engine.exec("DROP TABLE IF EXISTS experiment_results");
    ledger = await createLedger(engine, pinned());
    entryId = (await ledger.createDraft({ title: "Test", hypothesis: "H" }, "u")).id;
    const list = Array.from({ length: 4000 }, (_, i) => `p${i}@example.com`);
    assigned = (await assignAudience({ ledger, entryId, emails: list, treatmentShare: 0.5 })).rows;
  });
  afterEach(async () => {
    await dropLedgerTables(engine);
    await engine.exec("DROP TABLE IF EXISTS experiment_results");
    await engine.close?.();
  });

  type Row = { email: string; group: string; converted: string | null; revenue?: string | null };

  /** The plan's case: treatment converts at 12 percent with 40 dollar orders, control at 10 percent with 50 dollar orders. */
  function discountRows(): Row[] {
    // Exact realized rates, so the sign of the revenue difference does not depend on chance: the first 12 percent of the
    // treatment group and the first 10 percent of the control group convert.
    const size = { treatment: assigned.filter((a) => a.arm === "treatment").length, control: assigned.filter((a) => a.arm === "control").length };
    const seen = { treatment: 0, control: 0 };
    return assigned.map((a) => {
      const j = seen[a.arm]++;
      const converts = j < Math.round(size[a.arm] * (a.arm === "treatment" ? 0.12 : 0.1));
      return { email: a.email, group: a.arm, converted: converts ? "1" : "0", revenue: converts ? (a.arm === "treatment" ? "40" : "50") : null };
    });
  }
  const run = (rows: Row[]) => verifyResults({ engine, ledger, entryId, rows, treatmentShare: 0.5 });

  it("matches revenue per recipient counted straight from the rows, and shows the discount losing money", async () => {
    const rows = discountRows();
    const r = await run(rows);
    expect(r.revenue?.status).toBe("shown");
    if (r.revenue?.status !== "shown") return;
    const sum = (arm: string) => rows.filter((x) => x.group === arm).reduce((n, x) => n + (x.converted === "1" ? Number(x.revenue) : 0), 0);
    const count = (arm: string) => rows.filter((x) => x.group === arm).length;
    expect(r.revenue.treatment.n).toBe(count("treatment"));
    expect(r.revenue.control.n).toBe(count("control"));
    expect(r.revenue.treatment.perRecipient).toBeCloseTo(sum("treatment") / count("treatment"), 10);
    expect(r.revenue.control.perRecipient).toBeCloseTo(sum("control") / count("control"), 10);
    // The lift is positive and the revenue difference is negative: the sign the shortcut would get wrong.
    if (r.readout.status === "readable") expect(r.readout.readout.lift).toBeGreaterThan(0);
    expect(r.revenue.difference).toBeLessThan(0);
    expect(r.revenue.overTreated.estimate).toBeCloseTo(r.revenue.difference * r.revenue.treatment.n, 8);
  });

  it("has the right variance, the one a person would work out by hand", async () => {
    const rows = discountRows();
    const r = await run(rows);
    if (r.revenue?.status !== "shown") throw new Error("expected shown");
    const values = rows.filter((x) => x.group === "treatment").map((x) => (x.converted === "1" ? Number(x.revenue) : 0));
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const control = rows.filter((x) => x.group === "control").map((x) => (x.converted === "1" ? Number(x.revenue) : 0));
    const cMean = control.reduce((a, b) => a + b, 0) / control.length;
    const v = (xs: number[], m: number) => xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
    const se = Math.sqrt(v(values, mean) / values.length + v(control, cMean) / control.length);
    expect((r.revenue.high - r.revenue.low) / 2 / se).toBeGreaterThan(1.9);
    expect((r.revenue.high - r.revenue.low) / 2 / se).toBeLessThan(2.1);
  });

  it("has no revenue result at all when the file has no revenue column", async () => {
    const r = await run(discountRows().map((x) => ({ email: x.email, group: x.group, converted: x.converted })));
    expect(r.revenue).toBeNull();
  });

  it("does not show revenue when someone who converted has none, and says how many", async () => {
    const rows = discountRows();
    let removed = 0;
    for (const row of rows) {
      if (row.converted === "1" && removed < 3) {
        row.revenue = null;
        removed++;
      }
    }
    const r = await run(rows);
    expect(r.revenue).toMatchObject({ status: "not_shown", reason: "unreported_converters" });
    if (r.revenue?.status === "not_shown") expect(r.revenue.text).toContain("3 people who converted have no revenue value");
    // The lift is untouched.
    expect(r.readout.status).toBe("readable");
  });

  it("reads a currency sign or a thousands separator as not a number, so the person is not guessed at", async () => {
    const rows = discountRows();
    const first = rows.find((x) => x.converted === "1")!;
    first.revenue = "$40";
    const r = await run(rows);
    expect(r.revenue).toMatchObject({ status: "not_shown", reason: "unreported_converters" });
    if (r.revenue?.status === "not_shown") expect(r.revenue.notes.join(" ")).toContain("1 revenue value was not a plain number");
  });

  it.each(["40.50", " 40 ", "0", "0.99"])("accepts %s as a plain number", async (text) => {
    const rows = discountRows();
    rows.find((x) => x.converted === "1")!.revenue = text;
    expect((await run(rows)).revenue?.status).toBe("shown");
  });

  it.each(["-5", "1e3", "1,000", "NaN", "Infinity", "4 0"])("does not accept %s", async (text) => {
    const rows = discountRows();
    rows.find((x) => x.converted === "1")!.revenue = text;
    expect((await run(rows)).revenue?.status).toBe("not_shown");
  });

  it("ignores revenue on someone marked as not converted, and says so", async () => {
    const rows = discountRows();
    const stayed = rows.filter((x) => x.converted === "0").slice(0, 2);
    for (const x of stayed) x.revenue = "99";
    const base = (await run(discountRows())).revenue;
    const r = await run(rows);
    if (r.revenue?.status !== "shown" || base?.status !== "shown") throw new Error("expected shown");
    expect(r.revenue.treatment.perRecipient + r.revenue.control.perRecipient).toBeCloseTo(base.treatment.perRecipient + base.control.perRecipient, 10);
    expect(r.revenue.notes.join(" ")).toContain("2 people marked as not converted had a revenue value, which was ignored");
  });

  it("leaves people whose window is still open out of revenue, as it does out of the rate", async () => {
    const rows = discountRows();
    for (const x of rows.slice(0, 200)) {
      x.converted = null;
      x.revenue = "500";
    }
    const r = await run(rows);
    if (r.revenue?.status !== "shown") throw new Error("expected shown");
    const treated = rows.slice(200).filter((x) => x.group === "treatment");
    expect(r.revenue.treatment.n).toBe(treated.length);
    expect(r.revenue.treatment.perRecipient).toBeCloseTo(treated.reduce((n, x) => n + (x.converted === "1" ? Number(x.revenue) : 0), 0) / treated.length, 10);
  });

  it("shows means with no range when a group has under 30 purchases", async () => {
    const rows = discountRows();
    let kept = 0;
    for (const x of rows) {
      if (x.group === "control" && x.converted === "1") {
        if (kept >= 10) {
          x.converted = "0";
          x.revenue = null;
        }
        kept++;
      }
    }
    const r = await run(rows);
    expect(r.revenue?.status).toBe("means_only");
  });

  it("writes no email, hash or customer value into the results table", async () => {
    await run(discountRows());
    const columns = (await engine.all("SELECT column_name FROM information_schema.columns WHERE table_name = 'experiment_results' ORDER BY ordinal_position")).map((c) => String(c.column_name));
    expect(columns).toEqual(["arm", "converted", "received", "revenue"]);
  });
});
