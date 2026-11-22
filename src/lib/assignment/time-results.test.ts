import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNodeEngine } from "../intake/testing/node-engine";
import type { SqlEngine } from "../intake/types";
import { createLedger, dropLedgerTables, type Ledger } from "../ledger/ledger";
import { assignAudience, verifyResults } from "./assign";
import type { TimeContext } from "./conversion-time";

function pinned() {
  let counter = 0;
  return {
    newId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
    randomBytes: (n: number) => new Uint8Array(n).fill(9),
  };
}

/** Launch at 12:00 UTC on 1 March 2026, a 7 day window, a zone whose clocks change on 8 March. */
const time: TimeContext = { launchedAt: "2026-03-01T12:00:00.000Z", windowHours: 168, timeZone: "America/New_York" };

describe("conversion times through the results upload", () => {
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
    const list = Array.from({ length: 2000 }, (_, i) => `p${i}@example.com`);
    assigned = (await assignAudience({ ledger, entryId, emails: list, treatmentShare: 0.5 })).rows;
  });
  afterEach(async () => {
    await dropLedgerTables(engine);
    await engine.exec("DROP TABLE IF EXISTS experiment_results");
    await engine.close?.();
  });

  type Row = { email: string; group: string; converted: string | null; convertedAt?: string | null; revenue?: string | null };

  /** Everyone converts, so the readout counts show exactly who the time rules kept. Each row gets the given time. */
  function allConvert(at: (i: number) => string): Row[] {
    return assigned.map((a, i) => ({ email: a.email, group: a.arm, converted: "1", convertedAt: at(i) }));
  }
  const run = (rows: Row[], withTime: TimeContext | null = time) =>
    verifyResults({ engine, ledger, entryId, rows, treatmentShare: 0.5, time: withTime ?? undefined });
  const counted = async () => Number((await engine.all("SELECT count(*) AS n FROM experiment_results"))[0].n);
  const convertedCount = async () => Number((await engine.all("SELECT count(*) AS n FROM experiment_results WHERE converted")) [0].n);

  it("has no time result at all when the file has no time column, and changes nothing", async () => {
    const r = await run(assigned.map((a) => ({ email: a.email, group: a.arm, converted: "1" })));
    expect(r.verification.time).toBeUndefined();
    expect(await convertedCount()).toBe(2000);
  });

  it("has no time result without launch details, even if the column is there", async () => {
    const r = await run(allConvert(() => "2026-03-02T10:00:00Z"), null);
    expect(r.verification.time).toBeUndefined();
    expect(await convertedCount()).toBe(2000);
  });

  it("keeps everyone whose time is inside the window", async () => {
    const r = await run(allConvert(() => "2026-03-02T10:00:00Z"));
    expect(r.verification.time).toMatchObject({ inWindow: 2000, afterWindow: 0, beforeLaunch: 0, impossible: 0, ambiguous: 0, unreadable: 0, noTime: 0, timeZone: "America/New_York" });
    expect(await convertedCount()).toBe(2000);
  });

  it("counts a conversion after the window closed as not converted, and still counts the person", async () => {
    const r = await run(allConvert((i) => (i < 300 ? "2026-03-08T12:00:01Z" : "2026-03-08T12:00:00Z")));
    expect(r.verification.time?.afterWindow).toBe(300);
    expect(r.verification.time?.inWindow).toBe(1700);
    expect(await counted()).toBe(2000);
    expect(await convertedCount()).toBe(1700);
  });

  it("takes the revenue of someone who converted after the window out with them, without calling it ignored", async () => {
    const rows = allConvert((i) => (i < 300 ? "2026-03-08T12:00:01Z" : "2026-03-08T12:00:00Z")).map((x) => ({ ...x, revenue: "10" }));
    const r = await verifyResults({ engine, ledger, entryId, rows, treatmentShare: 0.5, time });
    expect(r.revenue?.status).toBe("shown");
    if (r.revenue?.status !== "shown") return;
    expect(r.revenue.notes.join(" ")).not.toContain("ignored");
    expect(r.revenue.treatment.purchasers + r.revenue.control.purchasers).toBe(1700);
  });

  it("leaves out someone who converted before launch, so they are in neither group's count", async () => {
    const r = await run(allConvert((i) => (i < 40 ? "2026-03-01T11:59:59Z" : "2026-03-02T10:00:00Z")));
    expect(r.verification.time?.beforeLaunch).toBe(40);
    expect(await counted()).toBe(1960);
  });

  it("leaves out a local time the clocks skipped, and one they showed twice, and says which", async () => {
    // A window that reaches November, so the ambiguous time is not simply after the window.
    const longWindow: TimeContext = { ...time, windowHours: 24 * 300 };
    const r = await run(
      allConvert((i) => (i < 10 ? "2026-03-08 02:30:00" : i < 25 ? "2026-11-01 01:30:00" : "2026-03-02 10:00:00")),
      longWindow,
    );
    expect(r.verification.time).toMatchObject({ impossible: 10, ambiguous: 15, inWindow: 1975 });
    expect(await counted()).toBe(1975);
  });

  it("leaves out a time that cannot be read, and keeps a converter with no time as the file says", async () => {
    const r = await run(allConvert((i) => (i < 7 ? "last tuesday" : i < 12 ? "" : "2026-03-02T10:00:00Z")));
    expect(r.verification.time).toMatchObject({ unreadable: 7, noTime: 5, inWindow: 1988 });
    expect(await counted()).toBe(1993);
    expect(await convertedCount()).toBe(1993);
  });

  it("does not look at the time of someone who did not convert or whose window is still open", async () => {
    const rows = allConvert(() => "garbage").map((x, i) => ({ ...x, converted: i % 2 === 0 ? "0" : null }));
    const r = await run(rows);
    expect(r.verification.time).toMatchObject({ unreadable: 0, inWindow: 0, afterWindow: 0 });
    expect(await counted()).toBe(2000);
  });

  it("reads times that carry an offset the same way, in any zone", async () => {
    const r = await run(allConvert((i) => (i % 2 === 0 ? "2026-03-02T05:00:00-05:00" : "2026-03-02T15:30:00+05:30")));
    expect(r.verification.time?.inWindow).toBe(2000);
  });

  it("does not count rows that are dropped for other reasons in the time counts", async () => {
    const rows = allConvert((i) => (i < 50 ? "2026-03-01T11:00:00Z" : "2026-03-02T10:00:00Z"));
    // The first person appears twice, so both copies are dropped before the time rules run.
    const r = await run([...rows, { ...rows[0] }]);
    expect(r.verification.duplicate).toBe(2);
    expect(r.verification.time?.beforeLaunch).toBe(49);
    expect(r.verification.time?.inWindow).toBe(1950);
  });

  it("writes no time into the results table", async () => {
    await run(allConvert(() => "2026-03-02T10:00:00Z"));
    const columns = (await engine.all("SELECT column_name FROM information_schema.columns WHERE table_name = 'experiment_results' ORDER BY ordinal_position")).map((c) => String(c.column_name));
    expect(columns).toEqual(["arm", "converted", "received", "revenue"]);
  });
});
