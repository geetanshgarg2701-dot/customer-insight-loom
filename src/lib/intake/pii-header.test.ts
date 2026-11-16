import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BlockedColumnError } from "../redaction/columns";
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

describe("a header row that is really data, as in a file with no header row", () => {
  const FILE = bytes(lines("jane.doe@example.com,555-123-4567,great", "sam.lee@example.com,555-987-6543,slow"));

  it("masks the text, blocks the column and never loads it", async () => {
    const headers = await intake.open(FILE);
    expect(headers.map((h) => [h.name, h.blocked])).toEqual([
      ["Column 1", true],
      ["Column 2", true],
      ["great", false],
    ]);
    for (const h of headers) expect(h.name).not.toMatch(/jane|555|example/);

    const mapping = defaultMapping(headers);
    expect(mapping.map((m) => m.include)).toEqual([false, false, true]);
    expect(mapping.map((m) => m.target)).toEqual(["Column 1", "Column 2", "great"]);
  });

  it("refuses a load that includes it, with an error that holds no file text", async () => {
    await intake.open(FILE);
    const error = await intake
      .load([{ source: 0, target: "contact", include: true }])
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BlockedColumnError);
    expect((error as Error).message).not.toMatch(/jane|example|555/);
  });

  it("keeps an ordinary header readable", async () => {
    const headers = await intake.open(bytes(lines("id,comment,score", "1,a,5")));
    expect(headers.map((h) => h.name)).toEqual(["id", "comment", "score"]);
  });
});
