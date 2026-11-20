import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assignAudience, verifyResults } from "../assignment/assign";
import { verifyResultsWhenOpen } from "../assignment/gated";
import { isReadoutOpen } from "../ledger/window";
import { resultRecord } from "../assignment/record";
import { createNodeEngine } from "../intake/testing/node-engine";
import type { SqlEngine } from "../intake/types";
import { SYNTHETIC_ACTOR, createLedger, dropLedgerTables, type Ledger } from "../ledger/ledger";
import { JOURNEY_START, ENTRY_DAYS } from "./journeys";
import { THEME_IDS } from "../insights/evidence";
import { JULY_LAUNCH, seedDemoLedger } from "./seed";
import {
  DEMO_DOMAIN,
  DEMO_POOL_SIZE,
  demoAudienceCsv,
  demoEmail,
  demoResultRows,
  demoResultsCsv,
} from "./synthetic";

let engine: SqlEngine;
let ledger: Ledger;

beforeEach(async () => {
  engine = await createNodeEngine();
  await dropLedgerTables(engine);
  await engine.exec("DROP TABLE IF EXISTS experiment_results");
  // Fixed ids and a fixed secret make every run identical. Without them, who lands in which group changes from run to
  // run, so a check that a 95 percent interval contains the planted lift failed about 1 run in 20, as it should.
  let counter = 0;
  ledger = await createLedger(engine, {
    newId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
    randomBytes: (n) => new Uint8Array(n).fill(7),
  });
});

afterEach(async () => {
  await dropLedgerTables(engine);
  await engine.exec("DROP TABLE IF EXISTS experiment_results");
  await engine.close?.();
});

describe("synthetic people", () => {
  it("uses the reserved .invalid domain, so no address can reach a real person", () => {
    expect(DEMO_DOMAIN).toBe("example.invalid");
    expect(demoEmail(0)).toBe("demo.person0@example.invalid");
    expect(demoEmail(41)).toBe("demo.person41@example.invalid");
  });

  it("writes a demo audience file with an email column and no real names", () => {
    const csv = demoAudienceCsv(5);
    const lines = csv.split("\r\n").filter(Boolean);
    expect(lines[0]).toBe("email,segment,signup_week");
    expect(lines).toHaveLength(6);
    expect(lines[1].startsWith("demo.person0@example.invalid,")).toBe(true);
    expect(() => demoAudienceCsv(DEMO_POOL_SIZE + 1)).toThrow(RangeError);
  });
});

describe("demo results for an entry", () => {
  it("covers exactly the demo people assigned to the entry, with a known planted lift", async () => {
    const entryId = (await ledger.createDraft({ title: "Mine", hypothesis: "H" }, "u")).id;
    const emails = Array.from({ length: 6000 }, (_, i) => demoEmail(i));
    await assignAudience({ ledger, entryId, emails, treatmentShare: 0.5 });

    const { rows, matched } = await demoResultRows({ ledger, entryId, baselineRate: 0.1, trueLift: 0.05, seed: 7 });
    expect(matched).toBe(6000);
    expect(rows).toHaveLength(6000);

    const result = await verifyResults({ engine, ledger, entryId, rows, treatmentShare: 0.5 });
    expect(result.verification).toMatchObject({ matched: 6000, unknown: 0, groupMismatch: 0, missing: 0 });
    expect(result.readout.status).toBe("readable");
    if (result.readout.status !== "readable") return;
    const { interval } = result.readout.readout;
    expect(interval.low).toBeLessThanOrEqual(0.05);
    expect(interval.high).toBeGreaterThanOrEqual(0.05);
  });

  it("is the same file every time for the same entry and seed", async () => {
    const entryId = (await ledger.createDraft({ title: "Mine", hypothesis: "H" }, "u")).id;
    await assignAudience({ ledger, entryId, emails: Array.from({ length: 300 }, (_, i) => demoEmail(i)), treatmentShare: 0.5 });
    const a = await demoResultRows({ ledger, entryId, baselineRate: 0.2, trueLift: 0, seed: 3 });
    const b = await demoResultRows({ ledger, entryId, baselineRate: 0.2, trueLift: 0, seed: 3 });
    expect(demoResultsCsv(a.rows)).toBe(demoResultsCsv(b.rows));
  });

  it("leaves some windows open when asked, as blank converted values", async () => {
    const entryId = (await ledger.createDraft({ title: "Mine", hypothesis: "H" }, "u")).id;
    await assignAudience({ ledger, entryId, emails: Array.from({ length: 2000 }, (_, i) => demoEmail(i)), treatmentShare: 0.5 });
    const { rows } = await demoResultRows({ ledger, entryId, baselineRate: 0.2, trueLift: 0, seed: 3, pendingShare: 0.05 });
    const open = rows.filter((r) => r.converted === "").length;
    expect(open).toBeGreaterThan(50);
    expect(open).toBeLessThan(150);
  });

  it("finds no one for an entry whose audience did not come from the demo pool", async () => {
    const entryId = (await ledger.createDraft({ title: "Real", hypothesis: "H" }, "u")).id;
    await assignAudience({ ledger, entryId, emails: ["someone@example.com"], treatmentShare: 0.5 });
    const { matched } = await demoResultRows({ ledger, entryId, baselineRate: 0.1, trueLift: 0, seed: 1 });
    expect(matched).toBe(0);
  });

  it("writes results as email, group, converted", () => {
    const csv = demoResultsCsv([
      { email: "demo.person1@example.invalid", group: "treatment", converted: "1" },
      { email: "demo.person2@example.invalid", group: "control", converted: "" },
    ]);
    expect(csv.split("\r\n")).toEqual([
      "email,group,converted",
      "demo.person1@example.invalid,treatment,1",
      "demo.person2@example.invalid,control,",
      "",
    ]);
  });
});

describe("seedDemoLedger, plan 6.1 guided first run", () => {
  it("creates one confirmatory readable entry, one exploratory, one running and one launched in July, all synthetic", { timeout: 60_000 }, async () => {
    await seedDemoLedger({ engine, ledger });
    const entries = await ledger.listEntries();
    expect(entries).toHaveLength(4);
    for (const e of entries) expect(e.synthetic).toBe(true);

    const [confirmatory, exploratory, running] = entries;
    expect(confirmatory).toMatchObject({ status: "readable", entryType: "confirmatory", correctionMethod: "not_applied", comparisonsCount: 1 });
    expect(exploratory).toMatchObject({ entryType: "exploratory", correctionMethod: "exploratory_label" });
    expect(running).toMatchObject({ status: "running", entryType: "confirmatory", result: null });
    expect(await ledger.listAssignments(running.id)).not.toHaveLength(0);
  });

  it("plants known lifts, and each readout lands in a safe range around them", { timeout: 60_000 }, async () => {
    // Assignment uses each ledger's own random secret, so the seeded readouts vary run to run.
    // Coverage and power are measured properly by the honesty harness. Here the range is about
    // six standard errors wide on each side, so a correct engine fails it less than once in a billion runs.
    await seedDemoLedger({ engine, ledger });
    const [confirmatory, exploratory] = await ledger.listEntries();
    const c = confirmatory.result as { lift: number; interval_low: number; interval_high: number };
    const truth = (confirmatory.design as { syntheticTrueLift: number }).syntheticTrueLift;
    expect(truth).toBe(0.04);
    expect(c.lift).toBeGreaterThan(truth - 0.06);
    expect(c.lift).toBeLessThan(truth + 0.06);
    expect(c.interval_low).toBeLessThan(c.lift);
    expect(c.interval_high).toBeGreaterThan(c.lift);

    const x = exploratory.result as { lift: number };
    expect((exploratory.design as { syntheticTrueLift: number }).syntheticTrueLift).toBe(0);
    expect(Math.abs(x.lift)).toBeLessThan(0.07);
  });

  it("dates the demo in the past, so every conversion window has really closed", { timeout: 60_000 }, async () => {
    await seedDemoLedger({ engine, ledger });
    const [confirmatory, exploratory, running] = await ledger.listEntries();
    const DAY = 86_400_000;
    for (const e of [confirmatory, exploratory, running]) {
      expect((e.design as { conversionWindowHours: number }).conversionWindowHours).toBe(168);
      expect(Date.parse(e.launchedAt!)).toBeLessThan(Date.now() - 7 * DAY);
      expect(isReadoutOpen(e, ledger.now())).toBe(true);
    }
    // The order that makes an entry confirmatory or exploratory survives the past dating.
    expect(Date.parse(confirmatory.registeredAt!)).toBeLessThan(Date.parse(confirmatory.launchedAt!));
    expect(Date.parse(exploratory.launchedAt!)).toBeLessThan(Date.parse(exploratory.registeredAt!));
    // Each readable entry has exactly one result version, the first readout.
    for (const e of [confirmatory, exploratory]) {
      const versions = await ledger.listResults(e.id);
      expect(versions.map((v) => [v.version, v.reason])).toEqual([[1, "first readout"]]);
    }
    expect(await ledger.listResults(running.id)).toEqual([]);
  });

  it("lets a visitor read out the running entry through the gate", { timeout: 60_000 }, async () => {
    await seedDemoLedger({ engine, ledger });
    const running = (await ledger.listEntries())[2];
    const share = (running.design as { treatmentShare: number }).treatmentShare;
    const { rows } = await demoResultRows({
      ledger,
      entryId: running.id,
      baselineRate: 0.12,
      trueLift: 0.04,
      seed: 5,
    });
    const result = await verifyResultsWhenOpen({ engine, ledger, entryId: running.id, rows, treatmentShare: share });
    expect(result.verification.unknown).toBe(0);
  });

  it("stores no email anywhere in the exported ledger", { timeout: 60_000 }, async () => {
    await seedDemoLedger({ engine, ledger });
    const text = JSON.stringify(await ledger.exportFile());
    expect(text).not.toContain("@");
    expect(text).not.toContain(DEMO_DOMAIN);
  });

  it("launches the fourth entry inside the demo journeys' dates, with a full week of journeys on each side", { timeout: 60_000 }, async () => {
    await seedDemoLedger({ engine, ledger });
    const july = (await ledger.listEntries())[3];
    const DAY = 86_400_000;
    const start = Date.parse(JOURNEY_START);
    expect(july.launchedAt).toBe(JULY_LAUNCH);
    expect(Date.parse(july.launchedAt!)).toBeGreaterThanOrEqual(start + 7 * DAY);
    expect(Date.parse(july.launchedAt!)).toBeLessThanOrEqual(start + (ENTRY_DAYS - 7) * DAY);
    expect(july.title).toMatch(/^Synthetic: /);
    expect(july.synthetic).toBe(true);
  });

  it("makes the July entry a confirmatory test on the shipping cost theme, read out with a planted lift of zero", { timeout: 60_000 }, async () => {
    await seedDemoLedger({ engine, ledger });
    const july = (await ledger.listEntries())[3];
    expect(july.themeId).toBe(THEME_IDS.shipping_cost);
    expect(july.entryType).toBe("confirmatory");
    expect((july.design as { syntheticTrueLift: number }).syntheticTrueLift).toBe(0);
    const actions = (await ledger.listAudit(july.id)).map((a) => a.action);
    expect(actions.indexOf("compliance_passed")).toBeLessThan(actions.indexOf("launched"));
    // A readout, when the mismatch check lets one through, lands near zero. About 1 time in 1,000 it holds the entry back.
    if (july.result !== null) {
      expect(Math.abs((july.result as { lift: number }).lift)).toBeLessThan(0.07);
      expect(Date.parse((july.result as { computed_at: string }).computed_at)).toBeGreaterThan(Date.parse(JULY_LAUNCH) + 7 * 86_400_000);
    }
  });

  it("refuses to seed a ledger that already has entries", async () => {
    await ledger.createDraft({ title: "Mine", hypothesis: "H" }, "u");
    await expect(seedDemoLedger({ engine, ledger })).rejects.toThrow(/empty ledger/i);
  });
});

describe("synthetic flag on entries", () => {
  it("is true only for entries the demo created, and survives export and import", async () => {
    const mine = await ledger.createDraft({ title: "Mine", hypothesis: "H" }, "user");
    const demo = await ledger.createDraft({ title: "Demo", hypothesis: "H" }, SYNTHETIC_ACTOR);
    expect(mine.synthetic).toBe(false);
    expect(demo.synthetic).toBe(true);
    const file = await ledger.exportFile();
    const other = await createNodeEngine({ isolated: true });
    try {
      const { importLedger } = await import("../ledger/export");
      const copy = await importLedger(other, file, {});
      const byTitle = Object.fromEntries((await copy.listEntries()).map((e) => [e.title, e]));
      expect(byTitle.Demo.synthetic).toBe(true);
      expect(byTitle.Mine.synthetic).toBe(false);
    } finally {
      await other.close?.();
    }
  });
});

describe("resultRecord", () => {
  it("keeps aggregates and the method, and no identity", async () => {
    const entryId = (await ledger.createDraft({ title: "Mine", hypothesis: "H" }, "u")).id;
    await assignAudience({ ledger, entryId, emails: Array.from({ length: 4000 }, (_, i) => demoEmail(i)), treatmentShare: 0.5 });
    const { rows } = await demoResultRows({ ledger, entryId, baselineRate: 0.1, trueLift: 0.05, seed: 2 });
    const r = await verifyResults({ engine, ledger, entryId, rows, treatmentShare: 0.5 });
    if (r.readout.status !== "readable") throw new Error("expected readable");
    const record = resultRecord(r.readout, r.verification, "2026-11-16T12:00:00.000Z");
    expect(record).toMatchObject({
      lift: r.readout.readout.lift,
      interval_low: r.readout.readout.interval.low,
      interval_high: r.readout.readout.interval.high,
      srm_pass: true,
      computed_at: "2026-11-16T12:00:00.000Z",
      engine_version: r.readout.readout.engineVersion,
    });
    expect(String(record.method)).toMatch(/Newcombe/);
    expect(JSON.stringify(record)).not.toContain("@");
  });
});

describe("the demo shows the planted result whatever random secret the ledger has", () => {
  // The ledger picks a random secret, so who lands in which group differs every time. If each person's outcome were
  // an independent draw, the zero lift entry would read "Significant: yes" about 1 load in 20 and the 4 point lift
  // entry would read "Significant: no" about 1 load in 5. A visitor, or a tester in a session, must see the same thing.
  const secrets = [1, 2, 3, 4, 5, 6, 7, 8];

  it("reads the confirmatory entry as significant and the zero lift entry as not, for every secret", { timeout: 120_000 }, async () => {
    for (const fill of secrets) {
      await dropLedgerTables(engine);
      await engine.exec("DROP TABLE IF EXISTS experiment_results");
      let counter = 0;
      const fresh = await createLedger(engine, {
        newId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
        randomBytes: (n) => new Uint8Array(n).fill(fill),
      });
      await seedDemoLedger({ engine, ledger: fresh });
      const [confirmatory, exploratory] = await fresh.listEntries();
      const c = confirmatory.result as { significant: boolean; lift: number };
      const x = exploratory.result as { significant: boolean; lift: number };
      expect(c.significant, `secret ${fill}: confirmatory`).toBe(true);
      expect(x.significant, `secret ${fill}: zero lift`).toBe(false);
      expect(c.lift, `secret ${fill}`).toBeCloseTo(0.04, 2);
      expect(Math.abs(x.lift), `secret ${fill}`).toBeLessThan(0.005);
    }
  });

  it("makes each group's conversions match its planted rate, up to rounding", async () => {
    const entryId = (await ledger.createDraft({ title: "Mine", hypothesis: "H" }, "u")).id;
    const emails = Array.from({ length: 4000 }, (_, i) => demoEmail(i));
    await assignAudience({ ledger, entryId, emails, treatmentShare: 0.5 });
    const { rows } = await demoResultRows({ ledger, entryId, baselineRate: 0.1, trueLift: 0.05, seed: 3 });
    for (const [arm, rate] of [["treatment", 0.15], ["control", 0.1]] as const) {
      const group = rows.filter((r) => r.group === arm);
      const converted = group.filter((r) => r.converted === "1").length;
      expect(converted).toBe(Math.round(group.length * rate));
    }
  });
});

describe("every label the demo stores is true", () => {
  it("never records benjamini_hochberg with fewer than two comparisons, because bh.ts runs nowhere", { timeout: 60_000 }, async () => {
    await seedDemoLedger({ engine, ledger });
    for (const e of await ledger.listEntries()) {
      if (e.result === null) continue;
      expect(
        e.correctionMethod === "benjamini_hochberg" && (e.comparisonsCount ?? 0) < 2,
        `${e.title} claims a correction that never ran`,
      ).toBe(false);
      for (const v of await ledger.listResults(e.id)) {
        expect(v.correctionMethod === "benjamini_hochberg" && v.comparisonsCount < 2, `${e.title} version ${v.version}`).toBe(false);
      }
    }
  });
});
