import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CsvParseError,
  EmptyFileError,
  NotLoadedError,
  TooManyColumnsError,
} from "./errors";
import { createIntake } from "./intake";
import { defaultMapping } from "./mapping";
import { bytes, bytesWithBom, lines } from "./testing/fixtures";
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

async function loadAll(data: Uint8Array) {
  const headers = await intake.open(data);
  const result = await intake.load(defaultMapping(headers));
  const preview = await intake.preview();
  return { headers, result, preview };
}

describe("basic load", () => {
  it("reads headers, loads rows and previews them in file order", async () => {
    const { headers, result, preview } = await loadAll(
      bytes(lines("id,comment,score", "1,great,5", "2,ok,3")),
    );
    expect(headers.map((h) => h.name)).toEqual(["id", "comment", "score"]);
    expect(result.rowCount).toBe(2);
    expect(preview.columns).toEqual(["id", "comment", "score"]);
    expect(preview.rows).toEqual([
      ["1", "great", "5"],
      ["2", "ok", "3"],
    ]);
  });

  it("loads only the columns the user maps, under the names the user chose", async () => {
    const headers = await intake.open(bytes(lines("id,comment,score", "1,great,5")));
    await intake.load([
      { source: 1, target: "feedback", include: true },
      { source: 2, target: "rating", include: true },
      { source: 0, target: "id", include: false },
    ]);
    const preview = await intake.preview();
    expect(headers).toHaveLength(3);
    expect(preview.columns).toEqual(["feedback", "rating"]);
    expect(preview.rows).toEqual([["great", "5"]]);
  });

  it("shows at most 20 rows and still reports the full row count", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => `${i + 1},text ${i + 1}`);
    const { result, preview } = await loadAll(bytes(lines("id,comment", ...rows)));
    expect(result.rowCount).toBe(25);
    expect(preview.rowCount).toBe(25);
    expect(preview.rows).toHaveLength(20);
    expect(preview.rows[0]).toEqual(["1", "text 1"]);
    expect(preview.rows[19]).toEqual(["20", "text 20"]);
  });

  it("refuses to preview before a load", async () => {
    await intake.open(bytes(lines("id,comment", "1,a")));
    await expect(intake.preview()).rejects.toBeInstanceOf(NotLoadedError);
  });
});

describe("parsing edge cases", () => {
  it("keeps commas and doubled quotes inside quoted fields", async () => {
    const { preview } = await loadAll(
      bytes(lines("id,comment", '1,"hello, world"', '2,"say ""hi"""')),
    );
    expect(preview.rows).toEqual([
      ["1", "hello, world"],
      ["2", 'say "hi"'],
    ]);
  });

  it("keeps newlines inside quoted fields", async () => {
    const { result, preview } = await loadAll(
      bytes('id,comment\n1,"line one\nline two"\n2,plain\n'),
    );
    expect(result.rowCount).toBe(2);
    expect(preview.rows[0]).toEqual(["1", "line one\nline two"]);
    expect(preview.rows[1]).toEqual(["2", "plain"]);
  });

  it("strips a byte order mark from the first header", async () => {
    const { headers, preview } = await loadAll(
      bytesWithBom(lines("id,comment", "1,x")),
    );
    expect(headers[0].name).toBe("id");
    expect(preview.columns[0]).toBe("id");
  });

  it("handles CRLF line endings with no stray carriage returns", async () => {
    const { preview } = await loadAll(
      bytes("id,comment\r\n1,a\r\n2,b\r\n"),
    );
    expect(preview.columns).toEqual(["id", "comment"]);
    expect(preview.rows).toEqual([
      ["1", "a"],
      ["2", "b"],
    ]);
  });

  it("handles a last line with no newline", async () => {
    const { preview } = await loadAll(bytes("id,comment\n1,a\n2,b"));
    expect(preview.rows).toEqual([
      ["1", "a"],
      ["2", "b"],
    ]);
  });

  it("rejects an empty file with a clear error", async () => {
    await expect(intake.open(new Uint8Array(0))).rejects.toBeInstanceOf(EmptyFileError);
  });

  it("treats a file of only whitespace or only a byte order mark as empty", async () => {
    await expect(intake.open(bytes("  \n\r\n\t"))).rejects.toBeInstanceOf(EmptyFileError);
    await expect(intake.open(bytesWithBom(""))).rejects.toBeInstanceOf(EmptyFileError);
  });

  it("loads a header only file as zero rows, with or without a final newline", async () => {
    for (const text of ["id,comment\n", "id,comment"]) {
      const { headers, result, preview } = await loadAll(bytes(text));
      expect(headers.map((h) => h.name)).toEqual(["id", "comment"]);
      expect(result.rowCount).toBe(0);
      expect(preview.columns).toEqual(["id", "comment"]);
      expect(preview.rows).toEqual([]);
    }
  });

  it("keeps duplicate header names and makes the mapped names unique", async () => {
    const { headers, preview } = await loadAll(
      bytes(lines("score,score,comment", "1,2,x")),
    );
    expect(headers.map((h) => h.name)).toEqual(["score", "score", "comment"]);
    expect(preview.columns).toEqual(["score", "score_2", "comment"]);
    expect(preview.rows).toEqual([["1", "2", "x"]]);
  });

  it("skips rows with too few fields and reports them", async () => {
    const { result, preview } = await loadAll(
      bytes(lines("id,comment,score", "1,a,5", "2,b", "3,,7", "4,d,8")),
    );
    expect(result.rowCount).toBe(3);
    expect(result.skipped.tooFewFields).toBe(1);
    expect(result.skipped.tooManyFields).toBe(0);
    expect(result.skipped.examples).toEqual([{ row: 2, reason: "too_few_fields" }]);
    // An empty field is real data, not a missing field, so row 3 stays.
    expect(preview.rows).toEqual([
      ["1", "a", "5"],
      ["3", null, "7"],
      ["4", "d", "8"],
    ]);
  });

  it("skips rows with too many fields and reports them", async () => {
    const { result, preview } = await loadAll(
      bytes(lines("id,comment", "1,a", "2,b,extra", "3,c,x,y,z,1,2,3,4,5,6", "4,d")),
    );
    expect(result.rowCount).toBe(2);
    expect(result.skipped.tooManyFields).toBe(2);
    expect(result.skipped.examples).toEqual([
      { row: 2, reason: "too_many_fields" },
      { row: 3, reason: "too_many_fields" },
    ]);
    expect(preview.rows).toEqual([
      ["1", "a"],
      ["4", "d"],
    ]);
  });

  it("detects a ragged row far into the file", async () => {
    const rows = Array.from({ length: 30000 }, (_, i) => `${i},x`);
    rows[25000] = "1,2,3";
    const { result } = await loadAll(bytes(lines("id,comment", ...rows)));
    expect(result.rowCount).toBe(29999);
    expect(result.skipped.tooManyFields).toBe(1);
    expect(result.skipped.examples[0].row).toBe(25001);
  });

  it("round trips unicode text exactly", async () => {
    const values = ["ñandú", "日本語のテキスト", "😀 party 🎉", "مرحبا بالعالم", "é combining", "Привет"];
    const csv = lines("id,comment", ...values.map((v, i) => `${i},${v}`));
    const { preview } = await loadAll(bytes(csv));
    expect(preview.rows.map((r) => r[1])).toEqual(values);
  });

  it("loads one very long field in full and clips only the preview", async () => {
    const long = "x".repeat(5_000_000);
    const { result, preview } = await loadAll(bytes(lines("id,comment", `1,${long}`)));
    expect(result.rowCount).toBe(1);
    const cell = preview.rows[0][1] as string;
    expect(cell).toHaveLength(503);
    expect(cell.endsWith("...")).toBe(true);
    const stored = await engine.all("SELECT length(v1) AS n FROM intake_rows");
    expect(Number(stored[0].n)).toBe(5_000_000);
  });

  it("rejects a field longer than the row limit with a clear error", async () => {
    const tooLong = "x".repeat(9_000_000);
    const run = async () => {
      const headers = await intake.open(bytes(lines("id,comment", `1,${tooLong}`)));
      await intake.load(defaultMapping(headers));
    };
    const error = await run().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CsvParseError);
    expect((error as Error).message).toMatch(/longer than/i);
  });

  it("rejects bytes that are not valid UTF-8", async () => {
    const bad = Uint8Array.from([
      ...bytes("id,comment\n1,"),
      0xe9,
      ...bytes("\n"),
    ]);
    const run = async () => {
      const headers = await intake.open(bad);
      await intake.load(defaultMapping(headers));
    };
    await expect(run()).rejects.toBeInstanceOf(CsvParseError);
  });

  it("accepts 1000 columns and rejects 1001", async () => {
    const names = (n: number) => Array.from({ length: n }, (_, i) => `c${i}x`).join(",");
    const ok = await intake.open(bytes(lines(names(1000))));
    expect(ok).toHaveLength(1000);
    await expect(intake.open(bytes(lines(names(1001))))).rejects.toBeInstanceOf(
      TooManyColumnsError,
    );
  });

  it("does not put customer text into error messages", async () => {
    const secret = "jane.doe@example.com";
    const bad = Uint8Array.from([...bytes(`id,comment\n1,${secret}`), 0xe9, ...bytes("\n")]);
    const error = await (async () => {
      const headers = await intake.open(bad);
      await intake.load(defaultMapping(headers));
    })().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CsvParseError);
    expect(String((error as Error).message)).not.toContain(secret);
  });
});
