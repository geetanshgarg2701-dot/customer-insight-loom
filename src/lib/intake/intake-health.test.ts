import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotLoadedError } from "./errors";
import { scoreHealth, type HealthInput } from "./health";
import { createIntake } from "./intake";
import { defaultMapping } from "./mapping";
import { bytes, lines } from "./testing/fixtures";
import { createNodeEngine } from "./testing/node-engine";
import type { Intake, SqlEngine } from "./types";

let engine: SqlEngine;
let intake: Intake;

beforeEach(async () => {
  engine = await createNodeEngine();
  intake = createIntake(engine);
});
afterEach(async () => {
  await intake.close();
});

async function load(text: string) {
  const headers = await intake.open(bytes(text));
  await intake.load(defaultMapping(headers));
}

describe("health of a loaded file, counted by hand", () => {
  // Seven data rows in the file. The last has too few fields, so it is skipped: 6 loaded.
  //   id          1,2,3,3,4,5            numbers, 5 distinct.
  //   amount      10.5, abc, 7, 7, 8, 12 numbers except "abc", which is row 2.
  //   order_date  five ISO dates and two that do not exist, 2026-02-30 on rows 3 and 4.
  //   note        ok, N/A, empty, empty, " fine", fine: 4 filled, one is a placeholder, one has a leading space.
  //   status      done on every row.
  //   Rows 3 and 4 are identical, so 1 row repeats.
  const FILE = lines(
    "id,amount,order_date,note,status",
    "1,10.5,2026-07-01,ok,done",
    "2,abc,2026-07-02,N/A,done",
    "3,7,2026-02-30,,done",
    "3,7,2026-02-30,,done",
    "4,8,2026-07-04, fine,done",
    "5,12,2026-07-05,fine,done",
    "9,1",
  );
  const EXPECTED: HealthInput = {
    rowsInFile: 7,
    rows: 6,
    duplicateRows: 1,
    columns: [
      { name: "id", nonNull: 6, placeholders: 0, distinct: 5, kind: "number", invalid: 0, strayWhitespace: 0 },
      { name: "amount", nonNull: 6, placeholders: 0, distinct: 5, kind: "number", invalid: 1, strayWhitespace: 0, examples: [2] },
      { name: "order_date", nonNull: 6, placeholders: 0, distinct: 5, kind: "date", invalid: 2, strayWhitespace: 0, examples: [3, 4] },
      { name: "note", nonNull: 4, placeholders: 1, distinct: 4, kind: "text", invalid: 0, strayWhitespace: 1 },
      { name: "status", nonNull: 6, placeholders: 0, distinct: 1, kind: "text", invalid: 0, strayWhitespace: 0 },
    ],
  };

  it("gives exactly the report the scoring makes from the hand counted file", async () => {
    await load(FILE);
    expect(await intake.health()).toEqual(scoreHealth(EXPECTED));
  });

  it("names the problems, with row numbers and never a cell value", async () => {
    await load(FILE);
    const r = await intake.health();
    const ids = r.findings.map((f) => `${f.id}:${f.column}`);
    expect(ids).toEqual(expect.arrayContaining(["skipped-rows:null", "duplicate-rows:null", "invalid-numbers:amount", "invalid-dates:order_date", "placeholders:note", "stray-spaces:note", "constant-column:status"]));
    expect(r.findings.find((f) => f.id === "invalid-dates")!.examples).toEqual([3, 4]);
    const text = JSON.stringify(r);
    // The advice names the words N/A and null in general, so those are not checked. These are values that only the file holds.
    for (const value of ["abc", "2026-02-30", "fine", "10.5"]) expect(text).not.toContain(value);
  });

  it("is refused before a file is loaded", async () => {
    await intake.open(bytes(lines("a", "1")));
    await expect(intake.health()).rejects.toBeInstanceOf(NotLoadedError);
  });
});

describe("health of other files", () => {
  it("scores a tidy file 100 and says nothing is wrong", async () => {
    await load(lines("id,amount,when", "1,5,2026-01-01", "2,6,2026-01-02", "3,7,2026-01-03"));
    const r = await intake.health();
    expect(r.score).toBe(100);
    expect(r.findings).toEqual([]);
  });

  it("only profiles the columns that were loaded", async () => {
    const headers = await intake.open(bytes(lines("id,amount,note", "1,abc,x", "2,5,y")));
    const mapping = defaultMapping(headers).map((m, i) => (i === 1 ? { ...m, include: false } : m));
    await intake.load(mapping);
    const r = await intake.health();
    expect(r.columns).toBe(2);
    expect(r.findings.find((f) => f.id === "invalid-numbers")).toBeUndefined();
  });

  it("treats a column that is mostly numbers as numbers, and a column of words as text", async () => {
    // 8 numbers and 2 words: 80 percent numbers, so a number column with 2 invalid cells. 5 words: text.
    const rows = ["1", "2", "3", "4", "5", "6", "7", "8", "x", "y"].map((n, i) => `${n},w${i % 5}`);
    await load(lines("n,w", ...rows));
    const r = await intake.health();
    expect(r.findings.find((f) => f.id === "invalid-numbers")).toMatchObject({ column: "n", count: 2 });
    expect(r.findings.some((f) => f.column === "w" && f.id === "invalid-numbers")).toBe(false);
  });

  it("handles a file of 100,000 rows quickly", async () => {
    const rows = Array.from({ length: 100_000 }, (_, i) => `${i},${i % 97},2026-01-${String((i % 28) + 1).padStart(2, "0")},w${i % 13}`);
    await load(lines("id,amount,when,word", ...rows));
    const started = Date.now();
    const r = await intake.health();
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(r.score).toBe(100);
  }, 120_000);
});
