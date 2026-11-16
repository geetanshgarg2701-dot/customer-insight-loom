import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNodeEngine } from "../intake/testing/node-engine";
import type { SqlEngine } from "../intake/types";
import { createLedger, dropLedgerTables, type Ledger } from "../ledger/ledger";
import { assignAudience, assignmentCsv } from "./assign";
import { rebuildAssignment } from "./rebuild";

let engine: SqlEngine;
let ledger: Ledger;
let entryId: string;

const emails = (n: number, prefix = "p") => Array.from({ length: n }, (_, i) => `${prefix}${i}@example.com`);

beforeEach(async () => {
  engine = await createNodeEngine();
  await dropLedgerTables(engine);
  ledger = await createLedger(engine, {});
  entryId = (await ledger.createDraft({ title: "T", hypothesis: "H" }, "u")).id;
});

afterEach(async () => {
  await dropLedgerTables(engine);
  await engine.close?.();
});

describe("rebuildAssignment", () => {
  it("makes the same download from the same audience file", async () => {
    const list = emails(3000);
    const first = await assignAudience({ ledger, entryId, emails: list, treatmentShare: 0.9 });
    const again = await rebuildAssignment({ ledger, entryId, emails: list, treatmentShare: 0.9 });
    expect(assignmentCsv(again.rows, entryId)).toBe(assignmentCsv(first.rows, entryId));
    expect(again).toMatchObject({ matched: 3000, unknown: 0, missing: 0, duplicates: 0, invalid: 0, inconsistent: 0 });
  });

  it("takes each group from the stored assignment, never from a new draw", async () => {
    await assignAudience({ ledger, entryId, emails: emails(500), treatmentShare: 0.5 });
    const stored = await ledger.listAssignments(entryId);
    const again = await rebuildAssignment({ ledger, entryId, emails: emails(500), treatmentShare: 0.5 });
    const treated = again.rows.filter((r) => r.arm === "treatment").length;
    expect(treated).toBe(stored.filter((s) => s.arm === "treatment").length);
  });

  it("leaves out people who were never assigned, so a different file cannot add anyone", async () => {
    await assignAudience({ ledger, entryId, emails: emails(200), treatmentShare: 0.5 });
    const mixed = [...emails(150), ...emails(80, "stranger")];
    const again = await rebuildAssignment({ ledger, entryId, emails: mixed, treatmentShare: 0.5 });
    expect(again.matched).toBe(150);
    expect(again.unknown).toBe(80);
    expect(again.missing).toBe(50);
    expect(again.rows.every((r) => r.email.startsWith("p"))).toBe(true);
  });

  it("matches emails the same way assignment does, and counts duplicates and invalid rows", async () => {
    await assignAudience({ ledger, entryId, emails: ["a@example.com", "b@example.com"], treatmentShare: 0.5 });
    const again = await rebuildAssignment({
      ledger,
      entryId,
      emails: [" A@Example.com ", "a@example.com", "", null, "not an email", "b@example.com"],
      treatmentShare: 0.5,
    });
    expect(again).toMatchObject({ matched: 2, duplicates: 1, invalid: 3, unknown: 0, missing: 0 });
  });

  it("flags a stored group that the hash no longer reproduces", async () => {
    // A wrong treatment share recomputes different groups for some people. They are left out and counted.
    await assignAudience({ ledger, entryId, emails: emails(1000), treatmentShare: 0.5 });
    const again = await rebuildAssignment({ ledger, entryId, emails: emails(1000), treatmentShare: 0.8 });
    expect(again.inconsistent).toBeGreaterThan(200);
    expect(again.inconsistent).toBeLessThan(400);
    expect(again.matched).toBe(1000 - again.inconsistent);
  });

  it("refuses an entry with no assignment yet", async () => {
    await expect(
      rebuildAssignment({ ledger, entryId, emails: emails(5), treatmentShare: 0.5 }),
    ).rejects.toThrow(/no assignment yet/i);
  });

  it("stores nothing new", async () => {
    await assignAudience({ ledger, entryId, emails: emails(100), treatmentShare: 0.5 });
    const before = JSON.stringify(await ledger.exportFile()).replace(/"exported_at":"[^"]+"/, "");
    await rebuildAssignment({ ledger, entryId, emails: emails(100), treatmentShare: 0.5 });
    const after = JSON.stringify(await ledger.exportFile()).replace(/"exported_at":"[^"]+"/, "");
    expect(after).toBe(before);
  });
});
