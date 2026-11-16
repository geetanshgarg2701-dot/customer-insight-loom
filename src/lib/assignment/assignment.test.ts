import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIntake } from "../intake/intake";
import { bytes, lines } from "../intake/testing/fixtures";
import { createNodeEngine } from "../intake/testing/node-engine";
import type { SqlEngine } from "../intake/types";
import { createLedger, dropLedgerTables, type Ledger } from "../ledger/ledger";
import { sampleRatioCheck } from "../stats/srm";
import { assignAudience, assignmentCsv, verifyResults } from "./assign";
import { bucketOf, customerHash, hmacHex, normalizeEmail } from "./hash";

const SECRET = "ab".repeat(32);
const ENTRY = "11111111-1111-4111-8111-111111111111";

describe("hashing", () => {
  it("matches the RFC 4231 HMAC SHA-256 test vector", async () => {
    // Test case 2: key "Jefe", data "what do ya want for nothing?".
    expect(await hmacHex("4a656665", "what do ya want for nothing?")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });

  it("normalizes email before hashing", async () => {
    expect(normalizeEmail("  Jane.Doe@Example.COM ")).toBe("jane.doe@example.com");
    expect(await customerHash(SECRET, " Jane.Doe@Example.COM")).toBe(
      await customerHash(SECRET, "jane.doe@example.com"),
    );
  });

  it("depends on the workspace secret", async () => {
    const a = await customerHash(SECRET, "jane@example.com");
    const b = await customerHash("cd".repeat(32), "jane@example.com");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it("puts each person in a bucket from 0 to 99 that is fixed per entry", async () => {
    const h = await customerHash(SECRET, "jane@example.com");
    const b = await bucketOf(SECRET, ENTRY, h);
    expect(Number.isInteger(b) && b >= 0 && b <= 99).toBe(true);
    expect(await bucketOf(SECRET, ENTRY, h)).toBe(b);
  });
});

describe("assignment", () => {
  let engine: SqlEngine;
  let ledger: Ledger;
  let entryId: string;

  beforeEach(async () => {
    engine = await createNodeEngine();
    await dropLedgerTables(engine);
    await engine.exec("DROP TABLE IF EXISTS experiment_results");
    ledger = await createLedger(engine, {});
    entryId = (await ledger.createDraft({ title: "Test", hypothesis: "H" }, "u")).id;
  });

  afterEach(async () => {
    await dropLedgerTables(engine);
    await engine.exec("DROP TABLE IF EXISTS experiment_results");
    await engine.close?.();
  });

  function emails(n: number, prefix = "person") {
    return Array.from({ length: n }, (_, i) => `${prefix}${i}@example.com`);
  }

  it("splits 100,000 people close to the planned share and passes the mismatch check", { timeout: 60_000 }, async () => {
    const r = await assignAudience({ ledger, entryId, emails: emails(100_000), treatmentShare: 0.9 });
    expect(r.assigned).toBe(100_000);
    expect(r.treatment + r.control).toBe(100_000);
    expect(r.treatment / 100_000).toBeGreaterThan(0.895);
    expect(r.treatment / 100_000).toBeLessThan(0.905);
    expect(sampleRatioCheck({ treatment: r.treatment, control: r.control }, 0.9).pass).toBe(true);
  });

  it("stores only hashes, never the raw email", async () => {
    await assignAudience({ ledger, entryId, emails: emails(50), treatmentShare: 0.5 });
    const file = JSON.stringify(await ledger.exportFile());
    expect(file).not.toContain("@");
    expect(file).not.toContain("example.com");
    const stored = await ledger.listAssignments(entryId);
    expect(stored).toHaveLength(50);
    for (const s of stored) expect(s.customerEmailHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic, and a second run cannot reshuffle anyone", async () => {
    const list = emails(200);
    const first = await assignAudience({ ledger, entryId, emails: list, treatmentShare: 0.5 });
    await expect(assignAudience({ ledger, entryId, emails: list, treatmentShare: 0.5 })).rejects.toThrow(
      /already has its assignment/i,
    );
    // Recomputing from the secret, the entry and the email gives the same arm.
    const secret = await ledger.workspaceSecret();
    for (const row of first.rows.slice(0, 50)) {
      const b = await bucketOf(secret, entryId, await customerHash(secret, row.email));
      expect(b < 50 ? "treatment" : "control").toBe(row.arm);
    }
  });

  it("assigns the same person independently in different entries", async () => {
    const list = emails(2000);
    const second = (await ledger.createDraft({ title: "Second", hypothesis: "H" }, "u")).id;
    const a = await assignAudience({ ledger, entryId, emails: list, treatmentShare: 0.5 });
    const b = await assignAudience({ ledger, entryId: second, emails: list, treatmentShare: 0.5 });
    const same = a.rows.filter((r, i) => r.arm === b.rows[i].arm).length;
    // Independent halves agree about half the time, not always.
    expect(same / 2000).toBeGreaterThan(0.45);
    expect(same / 2000).toBeLessThan(0.55);
  });

  it("counts duplicates and invalid emails instead of assigning them", async () => {
    const r = await assignAudience({
      ledger,
      entryId,
      emails: ["a@example.com", " A@Example.com ", "", "not an email", null, "b@example.com"],
      treatmentShare: 0.5,
    });
    expect(r.assigned).toBe(2);
    expect(r.duplicates).toBe(1);
    expect(r.invalid).toBe(3);
  });

  it("only accepts whole percent shares strictly between 0 and 1", async () => {
    for (const share of [0, 1, 0.555, -0.1, Number.NaN]) {
      await expect(assignAudience({ ledger, entryId, emails: emails(5), treatmentShare: share })).rejects.toThrow(
        RangeError,
      );
    }
  });

  it("writes a download the user's own send tool can use", () => {
    const csv = assignmentCsv(
      [
        { email: "jane@example.com", arm: "treatment" },
        { email: "=cmd@example.com", arm: "control" },
        { email: 'a,"b"@example.com', arm: "control" },
      ],
      ENTRY,
    );
    expect(csv.split("\r\n")).toEqual([
      "email,group,entry_id",
      `jane@example.com,treatment,${ENTRY}`,
      `'=cmd@example.com,control,${ENTRY}`,
      `"a,""b""@example.com",control,${ENTRY}`,
      "",
    ]);
  });
});

describe("results upload, verified against the stored assignment", () => {
  let engine: SqlEngine;
  let ledger: Ledger;
  let entryId: string;
  let assigned: { email: string; arm: "treatment" | "control" }[];

  beforeEach(async () => {
    engine = await createNodeEngine();
    await dropLedgerTables(engine);
    await engine.exec("DROP TABLE IF EXISTS experiment_results");
    ledger = await createLedger(engine, {});
    entryId = (await ledger.createDraft({ title: "Test", hypothesis: "H" }, "u")).id;
    const list = Array.from({ length: 4000 }, (_, i) => `p${i}@example.com`);
    assigned = (await assignAudience({ ledger, entryId, emails: list, treatmentShare: 0.5 })).rows;
  });

  afterEach(async () => {
    await dropLedgerTables(engine);
    await engine.exec("DROP TABLE IF EXISTS experiment_results");
    await engine.close?.();
  });

  /** Treatment converts 12 percent, control 10 percent, by position. */
  function honestRows() {
    return assigned.map((a, i) => ({
      email: a.email,
      group: a.arm,
      converted: (a.arm === "treatment" ? i % 100 < 12 : i % 100 < 10) ? "1" : "0",
    }));
  }

  it("matches every honest row and reads out", async () => {
    const r = await verifyResults({ engine, ledger, entryId, rows: honestRows(), treatmentShare: 0.5 });
    expect(r.verification).toMatchObject({ matched: 4000, unknown: 0, groupMismatch: 0, duplicate: 0, invalid: 0, missing: 0 });
    expect(r.readout.status).toBe("readable");
    if (r.readout.status === "readable") expect(r.readout.readout.lift).toBeGreaterThan(0);
  });

  it("excludes and counts a group that does not match the stored assignment", async () => {
    const rows = honestRows();
    rows[0] = { ...rows[0], group: rows[0].group === "treatment" ? "control" : "treatment" };
    rows[1] = { ...rows[1], group: rows[1].group === "treatment" ? "control" : "treatment" };
    const r = await verifyResults({ engine, ledger, entryId, rows, treatmentShare: 0.5 });
    expect(r.verification.groupMismatch).toBe(2);
    expect(r.verification.matched).toBe(3998);
  });

  it("excludes unknown people, duplicates and bad values", async () => {
    const rows = honestRows();
    rows.push({ email: "stranger@example.com", group: "treatment", converted: "1" });
    rows.push({ ...rows[5] });
    rows[10] = { ...rows[10], converted: "maybe" };
    rows[11] = { ...rows[11], group: "holdout" as never };
    const r = await verifyResults({ engine, ledger, entryId, rows, treatmentShare: 0.5 });
    expect(r.verification.unknown).toBe(1);
    // Both copies of the duplicated person are dropped, because neither can be trusted over the other.
    expect(r.verification.duplicate).toBe(2);
    expect(r.verification.invalid).toBe(2);
    // 4,002 rows: minus 2 invalid, 2 copies of one duplicated person, 1 stranger.
    expect(r.verification.matched).toBe(3997);
  });

  it("treats a blank conversion as a window still open, and counts people missing from the upload", async () => {
    const rows = honestRows().slice(0, 3900);
    rows[0] = { ...rows[0], converted: "" };
    const r = await verifyResults({ engine, ledger, entryId, rows, treatmentShare: 0.5 });
    expect(r.verification.missing).toBe(100);
    expect(r.verification.matched).toBe(3900);
    expect(r.readout.counts.treatment.pending + r.readout.counts.control.pending).toBe(1);
  });

  it("accepts the protected form of an email from its own download", async () => {
    const other = (await ledger.createDraft({ title: "Formula", hypothesis: "H" }, "u")).id;
    const a = await assignAudience({
      ledger,
      entryId: other,
      emails: ["=x@example.com", "y@example.com"],
      treatmentShare: 0.5,
    });
    const r = await verifyResults({
      engine,
      ledger,
      entryId: other,
      // The download wrote the first email as '=x@example.com to stop spreadsheets running it.
      rows: a.rows.map((row) => ({
        email: row.email.startsWith("=") ? `'${row.email}` : row.email,
        group: row.arm,
        converted: "0",
      })),
      treatmentShare: 0.5,
    });
    expect(r.verification).toMatchObject({ matched: 2, unknown: 0 });
  });

  it("does not strip a leading quote that is part of a real email", async () => {
    const rows = honestRows();
    rows[0] = { ...rows[0], email: `'${rows[0].email}` };
    const r = await verifyResults({ engine, ledger, entryId, rows, treatmentShare: 0.5 });
    expect(r.verification.unknown).toBe(1);
    expect(r.verification.missing).toBe(1);
  });

  it("blocks the readout when one group's rows went missing unevenly", async () => {
    // Drop 400 treatment rows: a sample ratio mismatch the check must catch.
    let dropped = 0;
    const rows = honestRows().filter((row) => {
      if (row.group === "treatment" && dropped < 400) {
        dropped++;
        return false;
      }
      return true;
    });
    const r = await verifyResults({ engine, ledger, entryId, rows, treatmentShare: 0.5 });
    expect(r.readout.status).toBe("blocked_srm");
  });

  it("keeps no email in the results table", async () => {
    await verifyResults({ engine, ledger, entryId, rows: honestRows(), treatmentShare: 0.5 });
    const columns = (await engine.all("SELECT column_name FROM information_schema.columns WHERE table_name = 'experiment_results'")).map(
      (r) => String(r.column_name),
    );
    expect(columns.sort()).toEqual(["arm", "converted"]);
  });
});

describe("end to end through the CSV intake", () => {
  it("reads the blocked email column only for matching, and the preview still blocks it", async () => {
    const engine = await createNodeEngine();
    await dropLedgerTables(engine);
    await engine.exec("DROP TABLE IF EXISTS experiment_results");
    try {
      const ledger = await createLedger(engine, {});
      const entryId = (await ledger.createDraft({ title: "CSV", hypothesis: "H" }, "u")).id;
      const intake = createIntake(engine);
      const audience = lines("email,first_name,score", "a@example.com,Ann,1", "b@example.com,Bo,2", "c@example.com,Cy,3");
      const headers = await intake.open(bytes(audience));
      const emailIndex = headers.findIndex((h) => h.name === "email");
      expect(headers[emailIndex].blocked).toBe(true);

      const { rows } = await intake.readColumnsForMatching([emailIndex]);
      const result = await assignAudience({ ledger, entryId, emails: rows.map((r) => r[0]), treatmentShare: 0.5 });
      expect(result.assigned).toBe(3);

      // The preview path is unchanged: the email column still cannot be loaded.
      await expect(intake.load([{ source: emailIndex, target: "contact", include: true }])).rejects.toThrow();

      // The user's send tool hands the downloaded file back with a converted column added.
      const resultsCsv = assignmentCsv(result.rows, entryId)
        .split("\r\n")
        .filter(Boolean)
        .map((line, i) => (i === 0 ? `${line},converted` : `${line},1`))
        .join("\n");
      const resultHeaders = await intake.open(bytes(resultsCsv + "\n"));
      const idx = (name: string) => resultHeaders.findIndex((h) => h.name === name);
      const parsed = await intake.readColumnsForMatching([idx("email"), idx("group"), idx("converted")]);
      const verified = await verifyResults({
        engine,
        ledger,
        entryId,
        rows: parsed.rows.map(([email, group, converted]) => ({ email, group, converted })),
        treatmentShare: 0.5,
      });
      expect(verified.verification.matched).toBe(3);
      await intake.close();
    } finally {
      await dropLedgerTables(engine).catch(() => {});
    }
  });
});
