import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createNodeEngine } from "../intake/testing/node-engine";
import type { SqlEngine } from "../intake/types";
import { LEDGER_SCHEMA_VERSION, LedgerImportError, importLedger } from "./export";
import { LedgerLockError, createLedger, type Ledger } from "./ledger";

let engines: SqlEngine[] = [];

async function freshEngine(): Promise<SqlEngine> {
  const e = await createNodeEngine({ isolated: true });
  engines.push(e);
  return e;
}

afterEach(async () => {
  for (const e of engines) await e.close?.();
  engines = [];
});

function clock(start = "2026-11-16T09:00:00.000Z") {
  let t = Date.parse(start);
  return () => new Date((t += 1000));
}

/** A small ledger with every kind of row: three entries in different states, a citation, assignments. */
async function seeded(): Promise<Ledger> {
  const ledger = await createLedger(await freshEngine(), { now: clock() });
  const a = await ledger.createDraft(
    { title: "Confirmatory", hypothesis: "H1", frameworkTag: "PAS", design: { split: 0.9, mde: 0.01 } },
    "user_1",
  );
  await ledger.register(a.id, "user_1");
  await ledger.launch(a.id, "user_1");
  await ledger.recordResult(
    a.id,
    { result: { lift: 0.02, low: 0.01, high: 0.03 }, comparisonsCount: 1, correctionMethod: "benjamini_hochberg" },
    "user_1",
  );
  const b = await ledger.createDraft({ title: "Exploratory", hypothesis: "H2" }, "user_1");
  await ledger.launch(b.id, "user_1");
  await ledger.register(b.id, "user_1");
  const c = await ledger.createDraft({ title: "Draft", hypothesis: "H3" }, "ai");
  await ledger.addCitation(a.id, "ledger_entries", b.id);
  await ledger.recordAssignments(a.id, [
    { customerEmailHash: "1".repeat(64), arm: "treatment" },
    { customerEmailHash: "2".repeat(64), arm: "control" },
  ]);
  void c;
  return ledger;
}

describe("export", () => {
  it("writes one JSON file with a schema version and every row", async () => {
    const ledger = await seeded();
    const file = await ledger.exportFile();
    expect(file.schema_version).toBe(LEDGER_SCHEMA_VERSION);
    expect(file.workspace_id).toBe(ledger.workspaceId);
    expect(file.entries).toHaveLength(3);
    expect(file.citations).toHaveLength(1);
    expect(file.assignments).toHaveLength(2);
    expect(file.audit.length).toBeGreaterThanOrEqual(8);
    // entry_type is computed, so it is never written.
    for (const e of file.entries) expect("entry_type" in e).toBe(false);
    expect(JSON.parse(JSON.stringify(file))).toEqual(file);
  });
});

describe("import, the plan 6.1 round trip", () => {
  it("imports into a fresh ledger with equal counts and an equal hash of sorted entry ids", async () => {
    const source = await seeded();
    const file = JSON.parse(JSON.stringify(await source.exportFile()));
    const before = await source.fingerprint();

    const target = await importLedger(await freshEngine(), file, { now: clock("2026-12-01T00:00:00.000Z") });
    const after = await target.fingerprint();

    expect(after).toEqual(before);
    expect(after.entryCount).toBe(3);
    expect(after.entryIdsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(target.workspaceId).not.toBe(source.workspaceId);
    expect(await target.listCitations()).toHaveLength(1);
  });

  it("keeps entry types and states, and marks imported entries", async () => {
    const source = await seeded();
    const target = await importLedger(await freshEngine(), await source.exportFile(), {});
    const byTitle = Object.fromEntries((await target.listEntries()).map((e) => [e.title, e]));
    expect(byTitle.Confirmatory).toMatchObject({ entryType: "confirmatory", status: "readable", provenance: "imported" });
    expect(byTitle.Exploratory).toMatchObject({ entryType: "exploratory", provenance: "imported" });
    expect(byTitle.Draft).toMatchObject({ entryType: null, status: "draft" });
    const actions = (await target.listAudit(byTitle.Draft.id)).map((a) => a.action);
    expect(actions).toEqual(["created", "imported"]);
  });

  it("puts every row under the importing workspace", async () => {
    const source = await seeded();
    const target = await importLedger(await freshEngine(), await source.exportFile(), {});
    for (const e of await target.listEntries()) expect(e.workspaceId).toBe(target.workspaceId);
  });

  it("carries the workspace secret so stored assignments can still be checked", async () => {
    const source = await seeded();
    const target = await importLedger(await freshEngine(), await source.exportFile(), {});
    expect(await target.workspaceSecret()).toBe(await source.workspaceSecret());
    const [first] = (await target.listEntries()).filter((e) => e.title === "Confirmatory");
    expect(await target.listAssignments(first.id)).toHaveLength(2);
  });

  it("still enforces the registration lock on imported entries", async () => {
    const source = await seeded();
    const target = await importLedger(await freshEngine(), await source.exportFile(), {});
    const [registered] = (await target.listEntries()).filter((e) => e.title === "Confirmatory");
    await expect(target.update(registered.id, { hypothesis: "Rewritten" }, "u")).rejects.toBeInstanceOf(
      LedgerLockError,
    );
  });

  it("survives a second round trip unchanged", async () => {
    const source = await seeded();
    const once = await importLedger(await freshEngine(), await source.exportFile(), {});
    const twice = await importLedger(await freshEngine(), await once.exportFile(), {});
    expect(await twice.fingerprint()).toEqual(await source.fingerprint());
    const [draft] = (await twice.listEntries()).filter((e) => e.title === "Draft");
    // One imported row per import, so the history shows both hops.
    expect((await twice.listAudit(draft.id)).map((a) => a.action)).toEqual(["created", "imported", "imported"]);
  });
});

describe("import validation", { timeout: 30_000 }, () => {
  let base = "";

  beforeAll(async () => {
    const source = await createLedger(await createNodeEngine({ isolated: true }), { now: clock() });
    const a = await source.createDraft({ title: "Confirmatory", hypothesis: "H1" }, "u");
    await source.register(a.id, "u");
    await source.launch(a.id, "u");
    await source.recordResult(
      a.id,
      { result: { lift: 0.02 }, comparisonsCount: 1, correctionMethod: "benjamini_hochberg" },
      "u",
    );
    const b = await source.createDraft({ title: "Second", hypothesis: "H2" }, "u");
    await source.createDraft({ title: "Third", hypothesis: "H3" }, "u");
    await source.addCitation(a.id, "ledger_entries", b.id);
    await source.recordAssignments(a.id, [
      { customerEmailHash: "1".repeat(64), arm: "treatment" },
      { customerEmailHash: "2".repeat(64), arm: "control" },
    ]);
    base = JSON.stringify(await source.exportFile());
  }, 30_000);

  async function file() {
    return JSON.parse(base);
  }

  async function expectRejected(bad: unknown, message: RegExp) {
    const engine = await freshEngine();
    const error = await importLedger(engine, bad, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LedgerImportError);
    expect((error as Error).message).toMatch(message);
    // Nothing half written: a later valid import into the same engine works.
    const ok = await importLedger(engine, await file(), {});
    expect((await ok.fingerprint()).entryCount).toBe(3);
  }

  it("rejects an unknown schema version with a plain message", async () => {
    const f = await file();
    f.schema_version = 99;
    await expectRejected(f, /version 99.*reads version 1/i);
  });

  it("rejects something that is not a ledger export", async () => {
    await expectRejected("hello", /not a ledger export/i);
    await expectRejected(null, /not a ledger export/i);
    await expectRejected({ schema_version: 1 }, /missing/i);
  });

  it("rejects a bad status, a bad id and a bad timestamp", async () => {
    const f1 = await file();
    f1.entries[0].status = "done";
    await expectRejected(f1, /status/i);
    const f2 = await file();
    f2.entries[0].id = "not-a-uuid";
    await expectRejected(f2, /id/i);
    const f3 = await file();
    f3.entries[0].registered_at = "yesterday";
    await expectRejected(f3, /time/i);
  });

  it("rejects a state the rules make impossible", async () => {
    const f = await file();
    const running = f.entries.find((e: { title: string }) => e.title === "Confirmatory");
    running.launched_at = null;
    await expectRejected(f, /launch/i);
  });

  it("rejects rows that point at a missing entry", async () => {
    const f = await file();
    f.citations[0].entry_id = "00000000-0000-4000-8000-000000000000";
    await expectRejected(f, /missing entry/i);
  });

  it("rejects duplicate entry ids and duplicate assignments", async () => {
    const f1 = await file();
    f1.entries[1].id = f1.entries[0].id;
    await expectRejected(f1, /duplicate/i);
    const f2 = await file();
    f2.assignments[1].customer_email_hash = f2.assignments[0].customer_email_hash;
    await expectRejected(f2, /duplicate/i);
  });

  it("refuses to import into a ledger that already has entries", async () => {
    const engine = await freshEngine();
    const existing = await createLedger(engine, {});
    await existing.createDraft({ title: "Mine", hypothesis: "H" }, "u");
    await expect(importLedger(engine, await file(), {})).rejects.toThrow(/empty ledger/i);
  });

  it("does not echo file text in its messages", async () => {
    const f = await file();
    f.entries[0].status = "secret-customer-text";
    const error = await importLedger(await freshEngine(), f, {}).catch((e: unknown) => e);
    expect((error as Error).message).not.toContain("secret-customer-text");
  });
});

describe("fingerprint", () => {
  it("does not depend on the order entries were created in", async () => {
    const ledger = await seeded();
    const fp = await ledger.fingerprint();
    const ids = (await ledger.listEntries()).map((e) => e.id).sort();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ids.join("\n")));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(fp).toEqual({ entryCount: 3, entryIdsHash: hex });
  });
});
