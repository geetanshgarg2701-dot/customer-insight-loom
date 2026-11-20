import { SYNTHETIC_EMAIL } from "../compliance/example";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assignAudience } from "../assignment/assign";
import { verifyResultsWhenOpen } from "../assignment/gated";
import { createNodeEngine } from "../intake/testing/node-engine";
import type { SqlEngine } from "../intake/types";
import { LedgerImportError, importLedger } from "./export";
import { LedgerStateError, createLedger, dropLedgerTables, type Ledger } from "./ledger";
import { ReadoutLockedError } from "./window";

const HOUR = 3_600_000;
const START = "2026-11-16T09:00:00.000Z";
const RESULT = { result: { lift: 0.02 }, comparisonsCount: 1, correctionMethod: "benjamini_hochberg" as const };

function makeClock(startIso: string) {
  let t = Date.parse(startIso);
  return {
    now: () => new Date(t),
    set: (ms: number) => {
      t = ms;
    },
    at: () => t,
  };
}

let engine: SqlEngine;
let clock: ReturnType<typeof makeClock>;
let ledger: Ledger;

beforeEach(async () => {
  engine = await createNodeEngine();
  await dropLedgerTables(engine);
  await engine.exec("DROP TABLE IF EXISTS experiment_results");
  clock = makeClock(START);
  ledger = await createLedger(engine, { now: clock.now });
});

afterEach(async () => {
  await dropLedgerTables(engine);
  await engine.exec("DROP TABLE IF EXISTS experiment_results");
  await engine.close?.();
});

async function launchedEntry(hours = 168) {
  const e = await ledger.createDraft(
    { title: "T", hypothesis: "H", design: { conversionWindowHours: hours, treatmentShare: 0.5 } },
    "u",
  );
  clock.set(Date.parse(START) + 1000);
  await ledger.recordComplianceCheck(e.id, SYNTHETIC_EMAIL, "u");
  await ledger.launch(e.id, "u");
  return ledger.getEntry(e.id);
}

describe("the ledger clock", () => {
  it("is exposed, so a screen and a check can ask the same clock", () => {
    expect(ledger.now().toISOString()).toBe(START);
  });
});

describe("launch needs a conversion window", () => {
  it("refuses a launch with no usable window", async () => {
    for (const design of [null, {}, { conversionWindowHours: 0 }, { conversionWindowHours: -5 }, { conversionWindowHours: "168" }]) {
      const e = await ledger.createDraft({ title: "T", hypothesis: "H", design }, "u");
      await expect(ledger.launch(e.id, "u"), JSON.stringify(design)).rejects.toBeInstanceOf(LedgerStateError);
      await expect(ledger.launch(e.id, "u")).rejects.toThrow(/conversion window/i);
    }
  });

  it("launches with a usable window", async () => {
    const e = await launchedEntry(24);
    expect(e.status).toBe("running");
  });
});

describe("recording a result waits for the window to close", () => {
  it("refuses at every point up to and including the closing instant, then allows", async () => {
    const e = await launchedEntry(168);
    const closes = Date.parse(e.launchedAt!) + 168 * HOUR;
    for (const ms of [closes - 7 * 24 * HOUR + 1, closes - HOUR, closes - 1, closes]) {
      clock.set(ms);
      const error = await ledger.recordResult(e.id, RESULT, "u").catch((x: unknown) => x);
      expect(error, String(ms)).toBeInstanceOf(ReadoutLockedError);
      expect((error as ReadoutLockedError).opensAt).toBe(new Date(closes).toISOString());
    }
    clock.set(closes + 1);
    const done = await ledger.recordResult(e.id, RESULT, "u");
    expect(done.status).toBe("readable");
  });

  it("changes nothing when it refuses", async () => {
    const e = await launchedEntry(168);
    await ledger.recordResult(e.id, RESULT, "u").catch(() => {});
    const after = await ledger.getEntry(e.id);
    expect(after.result).toBeNull();
    expect(after.status).toBe("running");
    expect(await ledger.listResults(e.id)).toEqual([]);
  });
});

describe("results are append only versions", () => {
  async function recordedEntry() {
    const e = await launchedEntry(168);
    clock.set(Date.parse(e.launchedAt!) + 168 * HOUR + 1000);
    await ledger.recordResult(e.id, RESULT, "u");
    return e;
  }

  it("keeps the first result as version 1 and on the entry", async () => {
    const e = await recordedEntry();
    const versions = await ledger.listResults(e.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 1, actor: "u", reason: "first readout", result: RESULT.result });
    expect((await ledger.getEntry(e.id)).result).toEqual(RESULT.result);
  });

  it("needs a reason for another version, and never touches the first result", async () => {
    const e = await recordedEntry();
    const second = { ...RESULT, result: { lift: 0.5 }, comparisonsCount: 4 };
    await expect(ledger.recordResult(e.id, second, "u")).rejects.toThrow(RangeError);
    await expect(ledger.recordResult(e.id, { ...second, reason: "   " }, "u")).rejects.toThrow(RangeError);

    clock.set(clock.at() + HOUR);
    await ledger.recordResult(e.id, { ...second, reason: "Recomputed after late events" }, "u");

    const versions = await ledger.listResults(e.id);
    expect(versions.map((v) => [v.version, v.reason])).toEqual([
      [1, "first readout"],
      [2, "Recomputed after late events"],
    ]);
    expect(versions[1].result).toEqual({ lift: 0.5 });
    const entry = await ledger.getEntry(e.id);
    expect(entry.result).toEqual(RESULT.result);
    expect(entry.comparisonsCount).toBe(1);
  });

  it("writes an audit row for each, in order", async () => {
    const e = await recordedEntry();
    clock.set(clock.at() + HOUR);
    await ledger.recordResult(e.id, { ...RESULT, reason: "Recomputed after late events" }, "u");
    const actions = (await ledger.listAudit(e.id)).map((a) => a.action);
    expect(actions).toEqual(["created", "compliance_passed", "launched", "result_recorded", "result_version_recorded"]);
  });

  it("does not add a version to a closed entry", async () => {
    const e = await recordedEntry();
    await ledger.close(e.id, "u");
    await expect(
      ledger.recordResult(e.id, { ...RESULT, reason: "late" }, "u"),
    ).rejects.toBeInstanceOf(LedgerStateError);
  });

  it("survives export and import with every version", async () => {
    const e = await recordedEntry();
    clock.set(clock.at() + HOUR);
    await ledger.recordResult(e.id, { ...RESULT, result: { lift: 0.4 }, reason: "Recomputed after late events" }, "u");
    const file = JSON.parse(JSON.stringify(await ledger.exportFile()));
    expect(file.results).toHaveLength(2);

    const other = await createNodeEngine({ isolated: true });
    try {
      const copy = await importLedger(other, file, { now: clock.now });
      const versions = await copy.listResults(e.id);
      expect(versions.map((v) => [v.version, v.reason, v.result])).toEqual([
        [1, "first readout", RESULT.result],
        [2, "Recomputed after late events", { lift: 0.4 }],
      ]);
      expect((await copy.getEntry(e.id)).result).toEqual(RESULT.result);
    } finally {
      await other.close?.();
    }
  });

  it("gives an old export with a result and no versions a version 1", async () => {
    const e = await recordedEntry();
    const file = JSON.parse(JSON.stringify(await ledger.exportFile()));
    delete file.results;
    const other = await createNodeEngine({ isolated: true });
    try {
      const copy = await importLedger(other, file, { now: clock.now });
      const versions = await copy.listResults(e.id);
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({ version: 1, result: RESULT.result });
      expect(versions[0].reason).toMatch(/export/i);
    } finally {
      await other.close?.();
    }
  });

  it("rejects a file with a duplicate version or a version for a missing entry", async () => {
    const e = await recordedEntry();
    const good = JSON.parse(JSON.stringify(await ledger.exportFile()));

    const dup = JSON.parse(JSON.stringify(good));
    dup.results.push({ ...dup.results[0], id: crypto.randomUUID() });
    const missing = JSON.parse(JSON.stringify(good));
    missing.results[0].entry_id = crypto.randomUUID();
    void e;

    for (const [bad, message] of [
      [dup, /duplicate/i],
      [missing, /missing entry/i],
    ] as const) {
      const other = await createNodeEngine({ isolated: true });
      try {
        const error = await importLedger(other, bad, {}).catch((x: unknown) => x);
        expect(error).toBeInstanceOf(LedgerImportError);
        expect((error as Error).message).toMatch(message);
      } finally {
        await other.close?.();
      }
    }
  });
});

describe("peeking is refused, which is review finding R1-1", () => {
  it("refuses a readout at five early looks, then allows it once the window closes", async () => {
    const e = await ledger.createDraft(
      { title: "T", hypothesis: "H", design: { conversionWindowHours: 168, treatmentShare: 0.5 } },
      "u",
    );
    const emails = Array.from({ length: 400 }, (_, i) => `p${i}@example.com`);
    const assigned = await assignAudience({ ledger, entryId: e.id, emails, treatmentShare: 0.5 });
    clock.set(Date.parse(START) + 1000);
    await ledger.recordComplianceCheck(e.id, SYNTHETIC_EMAIL, "u");
    await ledger.launch(e.id, "u");
    const launchedAt = Date.parse((await ledger.getEntry(e.id)).launchedAt!);
    const rows = assigned.rows.map((r, i) => ({ email: r.email, group: r.arm, converted: i % 10 === 0 ? "1" : "0" }));
    const input = { engine, ledger, entryId: e.id, rows, treatmentShare: 0.5 };

    // Looks on days 1 to 5 of a 7 day window, the scenario that gave a 14.2 percent false positive rate.
    for (const day of [1, 2, 3, 4, 5]) {
      clock.set(launchedAt + day * 24 * HOUR);
      await expect(verifyResultsWhenOpen(input), `day ${day}`).rejects.toBeInstanceOf(ReadoutLockedError);
    }
    const tables = await engine.all(
      "SELECT count(*) AS n FROM information_schema.tables WHERE table_name = 'experiment_results'",
    );
    expect(Number(tables[0].n)).toBe(0);

    clock.set(launchedAt + 7 * 24 * HOUR);
    await expect(verifyResultsWhenOpen(input)).rejects.toBeInstanceOf(ReadoutLockedError);

    clock.set(launchedAt + 7 * 24 * HOUR + 1);
    const result = await verifyResultsWhenOpen(input);
    expect(result.verification.matched).toBe(400);
  });

  it("refuses a readout for an entry that has not launched", async () => {
    const e = await ledger.createDraft(
      { title: "T", hypothesis: "H", design: { conversionWindowHours: 168 } },
      "u",
    );
    await expect(
      verifyResultsWhenOpen({ engine, ledger, entryId: e.id, rows: [], treatmentShare: 0.5 }),
    ).rejects.toThrow(/not launched/i);
  });
});
