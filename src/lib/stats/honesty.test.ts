import { describe, expect, it } from "vitest";
import { binomialCentralRange, normalQuantile } from "./distributions";
import { binomialSample, mulberry32, runAaSimulation, runPlantedLift } from "./honesty";

describe("random helpers", () => {
  it("are deterministic for a seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });

  it("produce uniform values in 0 to 1 with mean about one half", () => {
    const rng = mulberry32(7);
    let sum = 0;
    for (let i = 0; i < 100_000; i++) {
      const u = rng();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      sum += u;
    }
    expect(sum / 100_000).toBeCloseTo(0.5, 2);
  });

  it("draw binomial counts with the right mean", () => {
    const rng = mulberry32(9);
    let total = 0;
    for (let i = 0; i < 2000; i++) total += binomialSample(rng, 100, 0.3);
    expect(total / 2000).toBeCloseTo(30, 0);
  });
});

describe("A/A simulation, plan section 6.3", () => {
  it("calls about 5 percent of 1,000 null experiments significant, inside the 95 percent band", () => {
    const r = runAaSimulation({ experiments: 1000, nPerArm: 2000, rate: 0.05, seed: 20261115 });
    console.log(
      `[honesty] A/A: ${r.significantCount} of ${r.experiments} significant at alpha ${r.alpha}, ` +
        `band ${r.band.low} to ${r.band.high}, within band ${r.withinBand}`,
    );
    expect(r.experiments).toBe(1000);
    expect(r.band).toEqual(binomialCentralRange(1000, 0.05, 0.95));
    expect(r.withinBand).toBe(true);
  });

  it("catches a broken decision rule", () => {
    // An engine that uses z = 1.28, an 80 percent interval, while claiming alpha 0.05.
    const z80 = normalQuantile(0.9);
    const broken = (t: { n: number; conversions: number }, c: { n: number; conversions: number }) => {
      const pt = t.conversions / t.n;
      const pc = c.conversions / c.n;
      const se = Math.sqrt((pt * (1 - pt)) / t.n + (pc * (1 - pc)) / c.n);
      return Math.abs(pt - pc) > z80 * se;
    };
    const r = runAaSimulation({ experiments: 1000, nPerArm: 2000, rate: 0.05, seed: 20261115, decide: broken });
    expect(r.significantCount).toBeGreaterThan(r.band.high);
    expect(r.withinBand).toBe(false);
  });

  it("gives the same counts for the same seed", () => {
    const a = runAaSimulation({ experiments: 200, nPerArm: 500, rate: 0.1, seed: 5 });
    const b = runAaSimulation({ experiments: 200, nPerArm: 500, rate: 0.1, seed: 5 });
    expect(a.significantCount).toBe(b.significantCount);
  });
});

describe("planted lift simulation, plan section 6.3", () => {
  it("covers the true lift about 95 percent of the time and keeps the power promise", () => {
    const r = runPlantedLift({
      experiments: 500,
      baselineRate: 0.05,
      lift: 0.01,
      treatmentShare: 0.5,
      seed: 20261116,
    });
    console.log(
      [
        `[honesty] planted lift: true lift ${r.lift} on baseline ${r.baselineRate}, ` +
          `${r.nTreatment} treatment and ${r.nControl} control per experiment, sized by the power check`,
        `[honesty] interval contained the true lift in ${r.coverageCount} of ${r.experiments}, ` +
          `expected about ${r.expectedCoverage}, band ${r.coverageBand.low} to ${r.coverageBand.high}`,
        `[honesty] detected the lift in ${r.detectedCount} of ${r.experiments}, ` +
          `promised ${r.promisedCount} at power ${r.power}, lowest count consistent with the promise ${r.promiseFloor}`,
      ].join("\n"),
    );
    expect(r.experiments).toBe(500);
    expect(r.expectedCoverage).toBe(475);
    expect(r.coverageWithinBand).toBe(true);
    expect(r.promiseHeld).toBe(true);
  });

  it("catches an engine whose interval is too narrow", () => {
    const r = runPlantedLift({
      experiments: 500,
      baselineRate: 0.05,
      lift: 0.01,
      treatmentShare: 0.5,
      seed: 20261116,
      intervalAlpha: 0.3,
    });
    expect(r.coverageWithinBand).toBe(false);
  });
});
