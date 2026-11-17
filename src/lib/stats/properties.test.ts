import { describe, expect, it } from "vitest";
import { whatIf } from "../charts/whatif";
import { benjaminiHochberg } from "./bh";
import { binomialCdf } from "./distributions";
import { binomialSample, mulberry32 } from "./honesty";
import { powerCheck } from "./power";
import { newcombeDifference, readout, twoProportionPValue, wilsonInterval } from "./readout";
import { sampleRatioCheck } from "./srm";

/**
 * Property tests: random inputs, seeded so a failure can be reproduced, and statements that must hold for every one of
 * them. Hand picked examples can only show a function is right where someone looked. These look everywhere, and the
 * simulations check the statistics against what they claim, not against themselves.
 */

const rng = mulberry32(20261117);
const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const CASES = 300;

describe("wilsonInterval", () => {
  it("brackets the observed rate, stays inside 0 to 1, and is symmetric when successes and failures swap", () => {
    for (let i = 0; i < CASES; i++) {
      const n = int(1, 5000);
      const x = int(0, n);
      const alpha = [0.1, 0.05, 0.01][int(0, 2)];
      const w = wilsonInterval(x, n, alpha);
      const p = x / n;
      expect(w.low, `x=${x} n=${n}`).toBeGreaterThanOrEqual(0);
      expect(w.high).toBeLessThanOrEqual(1);
      expect(w.low).toBeLessThanOrEqual(p + 1e-12);
      expect(w.high).toBeGreaterThanOrEqual(p - 1e-12);
      const mirror = wilsonInterval(n - x, n, alpha);
      expect(mirror.low).toBeCloseTo(1 - w.high, 10);
      expect(mirror.high).toBeCloseTo(1 - w.low, 10);
    }
  });

  it("gets narrower with more people at the same rate, and wider at a stricter alpha", () => {
    for (let i = 0; i < CASES; i++) {
      const n = int(10, 2000);
      const x = int(1, n - 1);
      const w1 = wilsonInterval(x, n, 0.05);
      const w4 = wilsonInterval(4 * x, 4 * n, 0.05);
      expect(w4.high - w4.low).toBeLessThan(w1.high - w1.low);
      const strict = wilsonInterval(x, n, 0.01);
      expect(strict.high - strict.low).toBeGreaterThan(w1.high - w1.low);
    }
  });
});

describe("newcombeDifference", () => {
  it("brackets the observed difference, stays inside -1 to 1, and flips sign when the arms swap", () => {
    for (let i = 0; i < CASES; i++) {
      const n1 = int(1, 3000);
      const n2 = int(1, 3000);
      const x1 = int(0, n1);
      const x2 = int(0, n2);
      const d = x1 / n1 - x2 / n2;
      const a = newcombeDifference(x1, n1, x2, n2, 0.05);
      expect(a.low, `${x1}/${n1} v ${x2}/${n2}`).toBeGreaterThanOrEqual(-1);
      expect(a.high).toBeLessThanOrEqual(1);
      expect(a.low).toBeLessThanOrEqual(d + 1e-12);
      expect(a.high).toBeGreaterThanOrEqual(d - 1e-12);
      const b = newcombeDifference(x2, n2, x1, n1, 0.05);
      expect(b.low).toBeCloseTo(-a.high, 10);
      expect(b.high).toBeCloseTo(-a.low, 10);
    }
  });

  it("covers the true difference about 95 percent of the time in simulation", () => {
    // Two arms of 300, true rates 12 and 9 percent, so the true difference is 3 points.
    const trials = 4000;
    let covered = 0;
    for (let t = 0; t < trials; t++) {
      const x1 = binomialSample(rng, 300, 0.12);
      const x2 = binomialSample(rng, 300, 0.09);
      const ci = newcombeDifference(x1, 300, x2, 300, 0.05);
      if (ci.low <= 0.03 && 0.03 <= ci.high) covered++;
    }
    const coverage = covered / trials;
    console.log(`coverage, 300 per arm, rates 12 and 9 percent: ${(coverage * 100).toFixed(1)} percent`);
    // The hybrid score method is known to run slightly conservative, so a little above 95 percent is expected.
    expect(coverage).toBeGreaterThan(0.935);
    expect(coverage).toBeLessThan(0.98);
  });

  it("covers just as well at small rates and small groups, where a plain interval fails", () => {
    const trials = 4000;
    let covered = 0;
    for (let t = 0; t < trials; t++) {
      const x1 = binomialSample(rng, 120, 0.04);
      const x2 = binomialSample(rng, 120, 0.02);
      const ci = newcombeDifference(x1, 120, x2, 120, 0.05);
      if (ci.low <= 0.02 && 0.02 <= ci.high) covered++;
    }
    console.log(`coverage, 120 per arm, rates 4 and 2 percent: ${((covered / trials) * 100).toFixed(1)} percent`);
    expect(covered / trials).toBeGreaterThan(0.93);
  });
});

describe("twoProportionPValue and the readout", () => {
  it("is a probability, the same when the arms swap, and 1 when the rates are equal", () => {
    for (let i = 0; i < CASES; i++) {
      const n1 = int(5, 3000);
      const n2 = int(5, 3000);
      const x1 = int(0, n1);
      const x2 = int(0, n2);
      const p = twoProportionPValue(x1, n1, x2, n2);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      expect(twoProportionPValue(x2, n2, x1, n1)).toBeCloseTo(p, 12);
    }
    expect(twoProportionPValue(50, 500, 100, 1000)).toBeCloseTo(1, 12);
  });

  it("falls as the observed difference grows, for the same group sizes", () => {
    for (let i = 0; i < 100; i++) {
      const n = int(200, 4000);
      const base = int(Math.floor(n * 0.1), Math.floor(n * 0.4));
      let last = 1.01;
      for (let step = 0; step < 6; step++) {
        const p = twoProportionPValue(base + step * Math.ceil(n / 60), n, base, n);
        expect(p).toBeLessThanOrEqual(last + 1e-12);
        last = p;
      }
    }
  });

  it("calls a result significant exactly when the interval excludes zero, and the lift is the rates' difference", () => {
    for (let i = 0; i < CASES; i++) {
      const n1 = int(10, 4000);
      const n2 = int(10, 4000);
      const r = readout({ treatment: { n: n1, conversions: int(0, n1) }, control: { n: n2, conversions: int(0, n2) } });
      expect(r.significant).toBe(r.interval.low > 0 || r.interval.high < 0);
      expect(r.lift).toBeCloseTo(r.treatmentRate - r.controlRate, 12);
      expect(r.pValue).toBeGreaterThanOrEqual(0);
      expect(r.pValue).toBeLessThanOrEqual(1);
    }
  });

  it("agrees with the p value at ordinary sizes, so the two tests only part ways for very small counts", () => {
    // Review finding R1-13. With at least 500 people per arm and counts away from the edges, how often do they disagree?
    let disagree = 0;
    const cases = 2000;
    for (let i = 0; i < cases; i++) {
      const n = int(500, 5000);
      const c = int(Math.floor(n * 0.05), Math.floor(n * 0.5));
      const t = Math.max(0, Math.min(n, c + int(-Math.floor(n * 0.04), Math.floor(n * 0.04))));
      const r = readout({ treatment: { n, conversions: t }, control: { n, conversions: c } });
      if (r.significant !== r.pValue < 0.05) disagree++;
    }
    console.log(`significance call and p value disagree in ${disagree} of ${cases} ordinary size cases`);
    expect(disagree / cases).toBeLessThan(0.03);
  });
});

describe("power, checked against the readout it is meant to predict", () => {
  it("detects the minimum lift about 80 percent of the time when the audience is exactly the required size", () => {
    const input = { baselineRate: 0.1, minDetectableLift: 0.03, treatmentShare: 0.5, audienceSize: 100_000 };
    const need = powerCheck(input).requiredTreatment;
    const trials = 1500;
    let detected = 0;
    for (let t = 0; t < trials; t++) {
      const x1 = binomialSample(rng, need, 0.13);
      const x2 = binomialSample(rng, need, 0.1);
      if (readout({ treatment: { n: need, conversions: x1 }, control: { n: need, conversions: x2 } }).significant) detected++;
    }
    const rate = detected / trials;
    console.log(`power simulation: ${need} per arm detected the lift ${(rate * 100).toFixed(1)} percent of the time`);
    // The readout uses the conservative hybrid interval, so a little under 80 percent is expected. Far below would be a bug.
    expect(rate).toBeGreaterThan(0.74);
    expect(rate).toBeLessThan(0.86);
  });

  it("falsely calls a difference about 5 percent of the time when there is none", () => {
    const trials = 3000;
    let falsePositives = 0;
    for (let t = 0; t < trials; t++) {
      const x1 = binomialSample(rng, 800, 0.1);
      const x2 = binomialSample(rng, 800, 0.1);
      if (readout({ treatment: { n: 800, conversions: x1 }, control: { n: 800, conversions: x2 } }).significant) falsePositives++;
    }
    const rate = falsePositives / trials;
    console.log(`false positive rate with no real difference: ${(rate * 100).toFixed(1)} percent`);
    expect(rate).toBeGreaterThan(0.025);
    expect(rate).toBeLessThan(0.065);
  });

  it("needs fewer people for a bigger lift, and finds a smaller detectable lift with a bigger audience", () => {
    for (let i = 0; i < 100; i++) {
      const baseline = 0.02 + rng() * 0.4;
      const share = 0.2 + rng() * 0.6;
      const lift1 = 0.01 + rng() * 0.05;
      const lift2 = lift1 * 1.5;
      if (baseline + lift2 >= 0.99) continue;
      const a = powerCheck({ baselineRate: baseline, minDetectableLift: lift1, treatmentShare: share, audienceSize: 1000 });
      const b = powerCheck({ baselineRate: baseline, minDetectableLift: lift2, treatmentShare: share, audienceSize: 1000 });
      expect(b.requiredTotal).toBeLessThan(a.requiredTotal);
      const small = powerCheck({ baselineRate: baseline, minDetectableLift: lift1, treatmentShare: share, audienceSize: 4000 });
      const big = powerCheck({ baselineRate: baseline, minDetectableLift: lift1, treatmentShare: share, audienceSize: 16000 });
      if (small.smallestDetectableLift !== null && big.smallestDetectableLift !== null) {
        expect(big.smallestDetectableLift).toBeLessThan(small.smallestDetectableLift);
      }
    }
  });
});

describe("benjaminiHochberg", () => {
  const ps = (m: number) => Array.from({ length: m }, () => rng());

  it("never lowers a p value, keeps the order of p values, and does not depend on the order it is given", () => {
    for (let i = 0; i < 100; i++) {
      const p = ps(int(1, 40));
      const r = benjaminiHochberg(p);
      p.forEach((v, k) => expect(r.adjusted[k]).toBeGreaterThanOrEqual(v - 1e-12));
      const order = p.map((v, k) => k).sort((a, b) => p[a] - p[b]);
      for (let k = 1; k < order.length; k++) expect(r.adjusted[order[k]]).toBeGreaterThanOrEqual(r.adjusted[order[k - 1]] - 1e-12);
      const shuffled = [...p.keys()].sort(() => rng() - 0.5);
      const r2 = benjaminiHochberg(shuffled.map((k) => p[k]));
      shuffled.forEach((k, pos) => expect(r2.adjusted[pos]).toBeCloseTo(r.adjusted[k], 12));
    }
  });

  it("rejects at least what Bonferroni would, and more as q grows", () => {
    for (let i = 0; i < 100; i++) {
      const p = ps(int(2, 40)).map((v) => v * v * v);
      const m = p.length;
      const r = benjaminiHochberg(p, 0.05);
      p.forEach((v, k) => {
        if (v * m <= 0.05) expect(r.rejected[k]).toBe(true);
      });
      const looser = benjaminiHochberg(p, 0.2);
      r.rejected.forEach((rej, k) => {
        if (rej) expect(looser.rejected[k]).toBe(true);
      });
    }
  });

  it("makes at least one false discovery in about 5 percent of runs, or fewer, when nothing is real", () => {
    let any = 0;
    const trials = 2000;
    for (let t = 0; t < trials; t++) {
      if (benjaminiHochberg(ps(50)).rejected.some(Boolean)) any++;
    }
    const rate = any / trials;
    console.log(`Benjamini Hochberg, 50 true nulls, any false discovery: ${(rate * 100).toFixed(1)} percent of runs`);
    expect(rate).toBeLessThan(0.07);
  });
});

describe("sampleRatioCheck", () => {
  it("passes an exact split, is symmetric for an even plan, and fails a large imbalance", () => {
    for (let i = 0; i < 100; i++) {
      const n = int(1000, 200_000);
      expect(sampleRatioCheck({ treatment: n, control: n }, 0.5).pass).toBe(true);
      const a = sampleRatioCheck({ treatment: n + 30, control: n }, 0.5);
      const b = sampleRatioCheck({ treatment: n, control: n + 30 }, 0.5);
      expect(a.pValue).toBeCloseTo(b.pValue, 12);
      expect(a.pValue).toBeGreaterThanOrEqual(0);
      expect(a.pValue).toBeLessThanOrEqual(1);
    }
    expect(sampleRatioCheck({ treatment: 60_000, control: 40_000 }, 0.5).pass).toBe(false);
  });

  it("is a probability that is roughly uniform when the split is really random", () => {
    let below = 0;
    const trials = 2000;
    for (let t = 0; t < trials; t++) {
      const treatment = binomialSample(rng, 4000, 0.5);
      if (sampleRatioCheck({ treatment, control: 4000 - treatment }, 0.5).pValue < 0.05) below++;
    }
    console.log(`sample ratio check below 0.05 on a truly random split: ${((below / trials) * 100).toFixed(1)} percent`);
    expect(below / trials).toBeGreaterThan(0.025);
    expect(below / trials).toBeLessThan(0.08);
  });
});

describe("binomialCdf", () => {
  it("rises with k, reaches 1 at n, and matches adding up the probabilities directly", () => {
    for (let i = 0; i < 50; i++) {
      const n = int(1, 60);
      const p = 0.05 + rng() * 0.9;
      let last = 0;
      let direct = 0;
      let coeff = 1;
      for (let k = 0; k <= n; k++) {
        if (k > 0) coeff = (coeff * (n - k + 1)) / k;
        direct += coeff * p ** k * (1 - p) ** (n - k);
        const cdf = binomialCdf(k, n, p);
        expect(cdf).toBeGreaterThanOrEqual(last - 1e-12);
        expect(cdf).toBeCloseTo(Math.min(1, direct), 9);
        last = cdf;
      }
      expect(binomialCdf(n, n, p)).toBeCloseTo(1, 12);
    }
  });
});

describe("whatIf", () => {
  it("never lowers the end count when a step improves, never goes below zero, and is a no-op at zero points", () => {
    for (let i = 0; i < CASES; i++) {
      const top = int(100, 100_000);
      const counts = [top];
      for (let s = 0; s < 3; s++) counts.push(Math.floor(counts[s] * (0.1 + rng() * 0.8)));
      const stages = counts.map((count, k) => ({ stage: `S${k}`, count }));
      const step = int(0, 2);
      const base = whatIf(stages, { fromStep: step, points: 0 });
      expect(base.counts.map((c) => Math.round(c.count))).toEqual(counts);
      expect(base.extraAtEnd).toBeCloseTo(0, 6);
      let last = -Infinity;
      for (const points of [-30, -10, 0, 5, 20, 60]) {
        const r = whatIf(stages, { fromStep: step, points });
        const end = r.counts[3].count;
        expect(end).toBeGreaterThanOrEqual(last - 1e-9);
        expect(end).toBeGreaterThanOrEqual(0);
        for (let k = 1; k < r.counts.length; k++) expect(r.counts[k].count).toBeLessThanOrEqual(r.counts[k - 1].count + 1e-9);
        last = end;
      }
    }
  });
});
