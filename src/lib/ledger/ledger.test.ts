import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNodeEngine } from "../intake/testing/node-engine";
import type { SqlEngine } from "../intake/types";
import { LedgerLockError, LedgerStateError, createLedger, dropLedgerTables, type Ledger } from "./ledger";

/** A clock the test moves by hand, one second per tick. */
function fakeClock(start = "2026-11-16T09:00:00.000Z") {
  let t = Date.parse(start);
  return {
    now: () => new Date(t),
    tick: (seconds = 1) => {
      t += seconds * 1000;
    },
  };
}

let engine: SqlEngine;
let clock: ReturnType<typeof fakeClock>;
let ledger: Ledger;

beforeEach(async () => {
  engine = await createNodeEngine();
  await dropLedgerTables(engine);
  clock = fakeClock();
  ledger = await createLedger(engine, { now: clock.now });
});

afterEach(async () => {
  await dropLedgerTables(engine);
  await engine.close?.();
});

const DRAFT = { title: "Win back email", hypothesis: "A 10 percent offer lifts 30 day repurchase." };

describe("entries", () => {
  it("creates a draft with no entry type yet and logs it", async () => {
    const e = await ledger.createDraft(DRAFT, "user_1");
    expect(e).toMatchObject({
      title: DRAFT.title,
      hypothesis: DRAFT.hypothesis,
      status: "draft",
      registeredAt: null,
      launchedAt: null,
      entryType: null,
      provenance: "local",
      workspaceId: ledger.workspaceId,
    });
    expect(e.id).toMatch(/^[0-9a-f-]{36}$/);
    const audit = await ledger.listAudit(e.id);
    expect(audit.map((a) => [a.actor, a.action])).toEqual([["user_1", "created"]]);
  });

  it("stamps the registration time from the ledger clock", async () => {
    const e = await ledger.createDraft(DRAFT, "user_1");
    clock.tick(60);
    const r = await ledger.register(e.id, "user_1");
    expect(r.registeredAt).toBe("2026-11-16T09:01:00.000Z");
    expect(r.status).toBe("registered");
  });

  it("is confirmatory when registered before launch", async () => {
    const e = await ledger.createDraft(DRAFT, "u");
    await ledger.register(e.id, "u");
    clock.tick();
    const launched = await ledger.launch(e.id, "u");
    expect(launched.entryType).toBe("confirmatory");
    expect(launched.status).toBe("running");
  });

  it("is exploratory when launched before it was registered", async () => {
    const e = await ledger.createDraft(DRAFT, "u");
    await ledger.launch(e.id, "u");
    clock.tick();
    const late = await ledger.register(e.id, "u");
    expect(late.entryType).toBe("exploratory");
  });

  it("is exploratory when registered and launched in the same instant", async () => {
    const e = await ledger.createDraft(DRAFT, "u");
    await ledger.register(e.id, "u");
    const launched = await ledger.launch(e.id, "u");
    expect(launched.entryType).toBe("exploratory");
  });

  it("locks hypothesis, design and framework tag once registered", async () => {
    const e = await ledger.createDraft({ ...DRAFT, frameworkTag: "PAS", design: { split: 0.9 } }, "u");
    await ledger.update(e.id, { hypothesis: "Edited before registering" }, "u");
    await ledger.register(e.id, "u");
    for (const patch of [
      { hypothesis: "Changed after registering" },
      { design: { split: 0.5 } },
      { frameworkTag: "AIDA" as const },
    ]) {
      await expect(ledger.update(e.id, patch, "u")).rejects.toBeInstanceOf(LedgerLockError);
    }
    const kept = await ledger.getEntry(e.id);
    expect(kept.hypothesis).toBe("Edited before registering");
    expect(kept.design).toEqual({ split: 0.9 });
    expect(kept.frameworkTag).toBe("PAS");
    // A title fix stays allowed.
    expect((await ledger.update(e.id, { title: "Win back, v2" }, "u")).title).toBe("Win back, v2");
  });

  it("refuses to register twice or launch twice", async () => {
    const e = await ledger.createDraft(DRAFT, "u");
    await ledger.register(e.id, "u");
    await expect(ledger.register(e.id, "u")).rejects.toBeInstanceOf(LedgerLockError);
    await ledger.launch(e.id, "u");
    await expect(ledger.launch(e.id, "u")).rejects.toBeInstanceOf(LedgerLockError);
  });

  it("refuses fields the caller may not set", async () => {
    const e = await ledger.createDraft(DRAFT, "u");
    for (const patch of [{ entryType: "confirmatory" }, { registeredAt: "2020-01-01T00:00:00.000Z" }, { status: "closed" }]) {
      await expect(ledger.update(e.id, patch as never, "u")).rejects.toThrow(RangeError);
    }
  });

  it("follows the status order", async () => {
    const e = await ledger.createDraft(DRAFT, "u");
    const result = { lift: 0.02 };
    await expect(
      ledger.recordResult(e.id, { result, comparisonsCount: 1, correctionMethod: "benjamini_hochberg" }, "u"),
    ).rejects.toBeInstanceOf(LedgerStateError);
    await ledger.register(e.id, "u");
    clock.tick();
    await ledger.launch(e.id, "u");
    const readable = await ledger.recordResult(
      e.id,
      { result, comparisonsCount: 3, correctionMethod: "benjamini_hochberg" },
      "u",
    );
    expect(readable).toMatchObject({ status: "readable", result, comparisonsCount: 3 });
    const closed = await ledger.close(e.id, "u");
    expect(closed.status).toBe("closed");
    await expect(ledger.close(e.id, "u")).rejects.toBeInstanceOf(LedgerStateError);
    const actions = (await ledger.listAudit(e.id)).map((a) => a.action);
    expect(actions).toEqual(["created", "registered", "launched", "result_recorded", "closed"]);
  });

  it("validates enums and numbers", async () => {
    await expect(ledger.createDraft({ ...DRAFT, frameworkTag: "XYZ" as never }, "u")).rejects.toThrow(RangeError);
    await expect(ledger.createDraft({ ...DRAFT, title: "  " }, "u")).rejects.toThrow(RangeError);
    const e = await ledger.createDraft(DRAFT, "u");
    await ledger.launch(e.id, "u");
    await expect(
      ledger.recordResult(e.id, { result: {}, comparisonsCount: -1, correctionMethod: "benjamini_hochberg" }, "u"),
    ).rejects.toThrow(RangeError);
    await expect(
      ledger.recordResult(e.id, { result: {}, comparisonsCount: 1, correctionMethod: "holm" as never }, "u"),
    ).rejects.toThrow(RangeError);
  });

  it("stores hostile text verbatim through bound parameters", async () => {
    const hostile = `x'); DROP TABLE ledger_entries; -- "quoted" \\ back`;
    const e = await ledger.createDraft({ title: hostile, hypothesis: hostile }, "u");
    expect((await ledger.getEntry(e.id)).title).toBe(hostile);
    expect(await ledger.listEntries()).toHaveLength(1);
  });

  it("reports an unknown entry plainly", async () => {
    await expect(ledger.getEntry("00000000-0000-4000-8000-000000000000")).rejects.toThrow(/not found/i);
  });
});

describe("citations", () => {
  it("accepts a citation to a row that exists and rejects one that does not", async () => {
    const a = await ledger.createDraft(DRAFT, "u");
    const b = await ledger.createDraft({ ...DRAFT, title: "Second" }, "u");
    const c = await ledger.addCitation(a.id, "ledger_entries", b.id);
    expect(c).toMatchObject({ entryId: a.id, citedRowTable: "ledger_entries", citedRowId: b.id });
    await expect(
      ledger.addCitation(a.id, "ledger_entries", "00000000-0000-4000-8000-000000000000"),
    ).rejects.toThrow(/does not exist/i);
    await expect(ledger.addCitation(a.id, "quotes", b.id)).rejects.toThrow(RangeError);
    expect(await ledger.listCitations()).toHaveLength(1);
  });
});

describe("assignments", () => {
  const HASH_A = "a".repeat(64);
  const HASH_B = "b".repeat(64);

  it("are insert only, so a re-run cannot reshuffle anyone", async () => {
    const e = await ledger.createDraft(DRAFT, "u");
    await ledger.recordAssignments(e.id, [
      { customerEmailHash: HASH_A, arm: "treatment" },
      { customerEmailHash: HASH_B, arm: "control" },
    ]);
    await expect(
      ledger.recordAssignments(e.id, [{ customerEmailHash: HASH_A, arm: "control" }]),
    ).rejects.toThrow(/already assigned/i);
    const rows = await ledger.listAssignments(e.id);
    expect(rows.map((r) => [r.customerEmailHash, r.arm])).toEqual([
      [HASH_A, "treatment"],
      [HASH_B, "control"],
    ]);
  });

  it("validate the arm and the hash, and write nothing on a bad batch", async () => {
    const e = await ledger.createDraft(DRAFT, "u");
    await expect(
      ledger.recordAssignments(e.id, [
        { customerEmailHash: HASH_A, arm: "treatment" },
        { customerEmailHash: "not a hash", arm: "control" },
      ]),
    ).rejects.toThrow(RangeError);
    await expect(
      ledger.recordAssignments(e.id, [{ customerEmailHash: HASH_B, arm: "holdout" as never }]),
    ).rejects.toThrow(RangeError);
    expect(await ledger.listAssignments(e.id)).toEqual([]);
  });
});

describe("workspace secret", () => {
  it("is 32 random bytes in hex and stays the same", async () => {
    const s = await ledger.workspaceSecret();
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    expect(await ledger.workspaceSecret()).toBe(s);
  });
});
