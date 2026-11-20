import { describe, expect, it } from "vitest";
import { redact } from "../redaction/redact";
import { evaluatePlanted, generatePlanted } from "../redaction/testdata/planted";
import { HONESTY_NOTE, runAaSimulation, runPlantedLift } from "../stats/honesty";
import { SRM_THRESHOLD } from "../stats/srm";
import { STATS_ENGINE_VERSION } from "../stats/version";
import { RULE_VERSION } from "../redaction/types";
import { AA_SEED, METHOD_NOTES, PLANTED_SEED, REDACTION_LIMITS, runMethodsReport } from "./report";

describe("runMethodsReport", () => {
  it("runs the real harness with fixed seeds and reports the same counts as calling it directly", { timeout: 60_000 }, async () => {
    const report = await runMethodsReport();
    const aa = runAaSimulation({ experiments: 1000, nPerArm: 2000, rate: 0.05, seed: AA_SEED });
    expect(report.aa.significantCount).toBe(aa.significantCount);
    expect(report.aa.band).toEqual(aa.band);
    expect(report.aa.seed).toBe(AA_SEED);

    const planted = runPlantedLift({
      experiments: 500,
      baselineRate: 0.05,
      lift: 0.01,
      treatmentShare: 0.5,
      seed: PLANTED_SEED,
    });
    expect(report.planted.coverageCount).toBe(planted.coverageCount);
    expect(report.planted.detectedCount).toBe(planted.detectedCount);
    expect(report.planted.seed).toBe(PLANTED_SEED);
  });

  it("is the same every time", { timeout: 60_000 }, async () => {
    const a = await runMethodsReport();
    const b = await runMethodsReport();
    expect(b).toEqual(a);
  });

  it("carries the plan's honesty line and both engine versions", { timeout: 60_000 }, async () => {
    const report = await runMethodsReport();
    expect(report.note).toBe(HONESTY_NOTE);
    expect(report.statsEngineVersion).toBe(STATS_ENGINE_VERSION);
    expect(report.redaction.ruleVersion).toBe(RULE_VERSION);
  });

  it("reports redaction caught and missed per type from the planted set", { timeout: 60_000 }, async () => {
    const report = await runMethodsReport();
    const direct = evaluatePlanted(generatePlanted(), redact);
    expect(report.redaction.scores).toEqual(direct.scores);
    expect(report.redaction.total).toBe(200);
    for (const s of report.redaction.scores) expect(s.total).toBe(50);
    expect(report.redaction.caught + report.redaction.missed).toBe(200);
    expect(report.redaction.missedItems).toHaveLength(report.redaction.missed);
  });

  it("never carries a planted value into the report", { timeout: 60_000 }, async () => {
    const report = await runMethodsReport();
    const text = JSON.stringify(report);
    for (const item of generatePlanted().slice(0, 200)) {
      expect(text, item.id).not.toContain(item.value);
    }
    for (const m of report.redaction.missedItems) expect(Object.keys(m).sort()).toEqual(["id", "reason", "type", "variant"]);
  });

  it("reports progress in order, so a screen can show it", { timeout: 60_000 }, async () => {
    const steps: string[] = [];
    await runMethodsReport({ onProgress: (s) => steps.push(s) });
    expect(steps).toEqual(["A/A simulation", "Planted lift simulation", "Redaction planted set"]);
  });
});

describe("METHOD_NOTES", () => {
  it("covers each method in plain words, with the numbers taken from the code", () => {
    const names = METHOD_NOTES.map((n) => n.name);
    expect(names).toEqual([
      "Lift and interval",
      "Power check",
      "Sample ratio check",
      "Multiple comparisons",
      "Assignment",
      "Fixed horizon",
    ]);
    const byName = Object.fromEntries(METHOD_NOTES.map((n) => [n.name, n.text]));
    expect(byName["Sample ratio check"]).toContain(String(SRM_THRESHOLD));
    expect(byName["Lift and interval"]).toMatch(/Newcombe/);
    expect(byName["Multiple comparisons"]).toMatch(/Benjamini Hochberg/);
    expect(byName.Assignment).toMatch(/keyed hash/);
    for (const note of METHOD_NOTES) {
      expect(note.text.length, note.name).toBeGreaterThan(40);
      expect(note.text.includes("—"), note.name).toBe(false);
    }
  });

  it("states the redaction limits, including that names are only partly covered", () => {
    expect(REDACTION_LIMITS.join(" ")).toMatch(/names are only partly covered/i);
    for (const line of REDACTION_LIMITS) expect(line.includes("—")).toBe(false);
  });
});
