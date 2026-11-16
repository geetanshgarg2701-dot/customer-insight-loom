import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIntake } from "./intake";
import { defaultMapping } from "./mapping";
import { bytes } from "./testing/fixtures";
import { createNodeEngine } from "./testing/node-engine";
import type { Intake } from "./types";

const ROWS = 100_000;

/** Builds the fixture in memory. Nothing is written to disk or committed. */
function buildFixture(): Uint8Array {
  const out: string[] = ["id,campaign_name,comment,score,email"];
  for (let i = 1; i <= ROWS; i++) {
    out.push(
      `${i},camp${i % 50},"line ${i}, with a comma and ""quotes""",${i % 5},user${i}@example.com`,
    );
  }
  // Two ragged rows so the classification is also exercised at scale.
  out[70_000] = "70000,camp,short";
  out[80_000] = "80000,camp,a,3,x@example.com,extra";
  return bytes(out.join("\r\n") + "\r\n");
}

describe("100,000 row load", () => {
  let intake: Intake;
  let data: Uint8Array;

  beforeAll(async () => {
    data = buildFixture();
    intake = createIntake(await createNodeEngine());
  });

  afterAll(async () => {
    await intake.close();
  });

  it("loads and previews, and reports the timings", { timeout: 120_000 }, async () => {
    const t0 = performance.now();
    const headers = await intake.open(data);
    const t1 = performance.now();
    const result = await intake.load(defaultMapping(headers));
    const t2 = performance.now();
    const preview = await intake.preview();
    const t3 = performance.now();

    const mb = (data.length / 1_048_576).toFixed(2);
    console.log(
      [
        `[perf] fixture ${ROWS} rows, ${mb} MB, engine DuckDB-Wasm in Node blocking build`,
        `[perf] open header probe ${(t1 - t0).toFixed(0)} ms`,
        `[perf] load into table ${(t2 - t1).toFixed(0)} ms`,
        `[perf] open plus load ${(t2 - t0).toFixed(0)} ms`,
        `[perf] preview of ${preview.rows.length} rows ${(t3 - t2).toFixed(0)} ms`,
      ].join("\n"),
    );

    expect(result.rowCount).toBe(ROWS - 2);
    expect(result.skipped.tooFewFields).toBe(1);
    expect(result.skipped.tooManyFields).toBe(1);
    expect(preview.rows).toHaveLength(20);
    expect(preview.rows[0][0]).toBe("1");
    // The blocked email column is not in the preview.
    expect(preview.columns).toEqual(["id", "campaign_name", "comment", "score"]);
    // Generous ceilings so a slow machine does not fail the run.
    expect(t2 - t0).toBeLessThan(60_000);
    expect(t3 - t2).toBeLessThan(10_000);
  });
});
