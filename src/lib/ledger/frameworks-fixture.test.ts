import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SYNTHETIC_EMAIL } from "../compliance/example";
import { createNodeEngine } from "../intake/testing/node-engine";
import type { SqlEngine } from "../intake/types";
import { readout } from "../stats/readout";
import { importLedger } from "./export";
import { compareFrameworks } from "./frameworks";
import { createLedger, type FrameworkTag } from "./ledger";

/**
 * The browser test loads e2e/fixtures/frameworks-ledger.json, a real ledger export with tagged results, made by the ledger
 * code itself. This test checks that the committed file still imports and still gives the comparison the browser test
 * expects. To remake it after a schema change, run with WRITE_FRAMEWORK_FIXTURE=1.
 */

const FIXTURE = join(__dirname, "..", "..", "..", "e2e", "fixtures", "frameworks-ledger.json");
const WINDOW_HOURS = 168;

// Made up counts, 2,000 customers a group. PAS tests lift about 25 to 35 percent, FAB tests about nothing, and AIDA
// has too few tests to be shown.
const TESTS: [FrameworkTag | null, number, number][] = [
  ["PAS", 250, 200],
  ["PAS", 262, 198],
  ["PAS", 270, 205],
  ["PAS", 255, 196],
  ["PAS", 248, 190],
  ["FAB", 201, 200],
  ["FAB", 210, 204],
  ["FAB", 195, 199],
  ["FAB", 205, 208],
  ["FAB", 199, 197],
  ["AIDA", 230, 200],
  ["AIDA", 226, 201],
  [null, 220, 200],
];
const N = 2000;

let engines: SqlEngine[] = [];
afterEach(async () => {
  for (const e of engines) await e.close?.();
  engines = [];
});
async function engine() {
  const e = await createNodeEngine({ isolated: true });
  engines.push(e);
  return e;
}

async function build(): Promise<unknown> {
  let t = Date.parse("2026-10-01T09:00:00.000Z");
  const now = Object.assign(() => new Date((t += 1000)), { jump: (h: number) => void (t += h * 3_600_000) });
  const ledger = await createLedger(await engine(), { now });
  const ids: string[] = [];
  for (const [i, [tag, xT, xC]] of TESTS.entries()) {
    const e = await ledger.createDraft(
      { title: `Fixture test ${i + 1}${tag ? `, ${tag}` : ", no tag"}`, hypothesis: "Made up counts for the framework comparison", frameworkTag: tag, design: { conversionWindowHours: WINDOW_HOURS } },
      "fixture",
    );
    await ledger.register(e.id, "fixture");
    await ledger.recordComplianceCheck(e.id, SYNTHETIC_EMAIL, "fixture");
    await ledger.launch(e.id, "fixture");
    ids.push(e.id);
    void xT;
    void xC;
  }
  now.jump(WINDOW_HOURS + 1);
  for (const [i, [, xT, xC]] of TESTS.entries()) {
    const r = readout({ treatment: { conversions: xT, n: N }, control: { conversions: xC, n: N } });
    await ledger.recordResult(
      ids[i],
      {
        result: { lift: r.lift, interval_low: r.interval.low, interval_high: r.interval.high, significant: r.significant, p_value: r.pValue, treatment_rate: r.treatmentRate, control_rate: r.controlRate, sample_sizes: r.sampleSizes, engine_version: r.engineVersion },
        comparisonsCount: 1,
        correctionMethod: "not_applied",
      },
      "fixture",
    );
  }
  return ledger.exportFile();
}

describe("the framework comparison fixture", () => {
  it.runIf(process.env.WRITE_FRAMEWORK_FIXTURE === "1")("is written", async () => {
    // The fixture has no assignments, so its secret protects nothing. A plain fake value keeps secret scanners quiet and
    // makes plain that it is not a real one.
    const file = { ...((await build()) as Record<string, unknown>), workspace_secret: "0".repeat(64) };
    writeFileSync(FIXTURE, JSON.stringify(file, null, 2) + "\n");
  }, 120_000);

  it("imports, and shows PAS ahead of FAB with AIDA too small", async () => {
    const file = JSON.parse(readFileSync(FIXTURE, "utf8")) as { workspace_secret: string };
    expect(file.workspace_secret).toBe("0".repeat(64));
    const ledger = await importLedger(await engine(), file, {});
    const entries = await ledger.listEntries();
    expect(entries).toHaveLength(TESTS.length);
    const out = compareFrameworks(entries);
    expect(out.groups.map((g) => [g.tag, g.tests, g.pooled !== null])).toEqual([
      ["PAS", 5, true],
      ["FAB", 5, true],
      ["AIDA", 2, false],
    ]);
    expect(out.excluded.noTag).toBe(1);
    expect(out.pairs).toHaveLength(1);
    expect(out.pairs[0]).toMatchObject({ a: "PAS", b: "FAB", flagged: true, comparisons: 1 });
    expect(out.text).toMatch(/^PAS tests lifted more than FAB tests, by \d+\.\d percent relative, after the Holm correction across 1 comparison\./);
  }, 120_000);
});
