import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BlockedColumnError, isBlockedColumn } from "../redaction/columns";
import { createIntake } from "./intake";
import { defaultMapping } from "./mapping";
import { bytes, bytesWithBom, lines } from "./testing/fixtures";
import { createNodeEngine } from "./testing/node-engine";
import type { Intake, SqlEngine } from "./types";

const EMAIL_1 = "jane.doe@example.com";
const EMAIL_2 = "sam.lee@example.com";
const PHONE_1 = "555-0100";

const CSV = lines(
  "id,email,phone,customer_name,comment,score",
  `1,${EMAIL_1},${PHONE_1},Jane Doe,loved it,5`,
  `2,${EMAIL_2},555-0101,Sam Lee,too slow,2`,
);

let engine: SqlEngine;
let intake: Intake;

beforeEach(async () => {
  engine = await createNodeEngine();
  intake = createIntake(engine);
});

afterEach(async () => {
  await intake.close();
});

async function tableExists(): Promise<boolean> {
  const rows = await engine.all(
    "SELECT count(*) AS n FROM information_schema.tables WHERE table_name = 'intake_rows'",
  );
  return Number(rows[0].n) > 0;
}

async function everyStoredValue(): Promise<unknown[]> {
  const rows = await engine.all("SELECT * FROM intake_rows");
  return rows.flatMap((r) => Object.values(r));
}

describe("blocked columns", () => {
  it("flags exactly the columns the redaction rule blocks", async () => {
    const headers = await intake.open(bytes(CSV));
    for (const h of headers) expect(h.blocked).toBe(isBlockedColumn(h.name));
    expect(headers.filter((h) => h.blocked).map((h) => h.name)).toEqual([
      "email",
      "phone",
      "customer_name",
    ]);
  });

  it("leaves blocked columns out of the default mapping", async () => {
    const headers = await intake.open(bytes(CSV));
    const included = defaultMapping(headers).filter((m) => m.include);
    expect(included.map((m) => headers[m.source].name)).toEqual(["id", "comment", "score"]);
  });

  it("never lets a blocked column value reach the preview or the stored table", async () => {
    const headers = await intake.open(bytes(CSV));
    await intake.load(defaultMapping(headers));
    const preview = await intake.preview();

    expect(preview.columns).toEqual(["id", "comment", "score"]);
    const shown = JSON.stringify(preview.rows);
    for (const secret of [EMAIL_1, EMAIL_2, PHONE_1, "Jane Doe", "Sam Lee"]) {
      expect(shown).not.toContain(secret);
    }

    const stored = JSON.stringify(
      (await everyStoredValue()).map((v) => (typeof v === "bigint" ? v.toString() : v)),
    );
    for (const secret of [EMAIL_1, EMAIL_2, PHONE_1, "Jane Doe", "Sam Lee"]) {
      expect(stored).not.toContain(secret);
    }
  });

  it("refuses to load a mapping that includes a blocked column", async () => {
    await intake.open(bytes(CSV));
    await expect(
      intake.load([
        { source: 4, target: "comment", include: true },
        { source: 1, target: "email", include: true },
      ]),
    ).rejects.toBeInstanceOf(BlockedColumnError);
    expect(await tableExists()).toBe(false);
    await expect(intake.preview()).rejects.toThrow();
  });

  it("refuses a blocked column renamed to an innocent name", async () => {
    await intake.open(bytes(CSV));
    await expect(
      intake.load([{ source: 1, target: "notes", include: true }]),
    ).rejects.toBeInstanceOf(BlockedColumnError);
    expect(await tableExists()).toBe(false);
  });

  it("refuses an allowed column renamed to a blocked name", async () => {
    await intake.open(bytes(CSV));
    await expect(
      intake.load([{ source: 4, target: "email", include: true }]),
    ).rejects.toBeInstanceOf(BlockedColumnError);
    expect(await tableExists()).toBe(false);
  });

  it("blocks every copy of a duplicated header name", async () => {
    const headers = await intake.open(
      bytes(lines("name,name,comment", "Jane,Janet,fine")),
    );
    expect(headers.map((h) => h.blocked)).toEqual([true, true, false]);
    await expect(
      intake.load([{ source: 1, target: "label", include: true }]),
    ).rejects.toBeInstanceOf(BlockedColumnError);
  });

  it("blocks a column even when a byte order mark precedes its name", async () => {
    const headers = await intake.open(
      bytesWithBom(lines("Email,comment", `${EMAIL_1},fine`)),
    );
    expect(headers[0]).toMatchObject({ name: "Email", blocked: true });
    await expect(
      intake.load([{ source: 0, target: "contact", include: true }]),
    ).rejects.toBeInstanceOf(BlockedColumnError);
  });

  it("blocks an unnamed header column, because an unreadable name fails closed", async () => {
    const headers = await intake.open(bytes(lines("id,,comment", "1,hidden@example.com,fine")));
    expect(headers[1].blocked).toBe(true);
    await intake.load(defaultMapping(headers));
    const preview = await intake.preview();
    expect(JSON.stringify(preview.rows)).not.toContain("hidden@example.com");
  });

  it("uses the original header text, not a renamed copy, for the rule", async () => {
    const names = ["E-mail", "Phone Number", "billing_address", "FirstName", "zip_code"];
    const headers = await intake.open(
      bytes(lines([...names, "comment"].join(","), "a,b,c,d,e,fine")),
    );
    expect(headers.slice(0, 5).every((h) => h.blocked)).toBe(true);
    await intake.load(defaultMapping(headers));
    const preview = await intake.preview();
    expect(preview.columns).toEqual(["comment"]);
    expect(preview.rows).toEqual([["fine"]]);
  });

  it("does not let a ragged row smuggle blocked values into the table", async () => {
    const headers = await intake.open(
      bytes(lines("email,comment", `${EMAIL_1},fine`, `${EMAIL_2}`, `${EMAIL_2},x,extra`)),
    );
    const result = await intake.load(defaultMapping(headers));
    expect(result.skipped.tooFewFields).toBe(1);
    expect(result.skipped.tooManyFields).toBe(1);
    const stored = JSON.stringify(
      (await everyStoredValue()).map((v) => (typeof v === "bigint" ? v.toString() : v)),
    );
    expect(stored).not.toContain("example.com");
  });
});
