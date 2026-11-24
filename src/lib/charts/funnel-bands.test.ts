import { describe, expect, it } from "vitest";
import { bandPath, funnelScale, layoutFunnel } from "./funnel-bands";

const O = { maxHeight: 200, top: 40, columnGap: 160 };
const lcg = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

describe("funnel bands", () => {
  const stages = [
    { stage: "Lead", count: 88_407 },
    { stage: "Qualified", count: 52_171 },
    { stage: "Proposal", count: 31_277 },
    { stage: "Won", count: 14_142 },
  ];

  it("starts at zero: the first pillar is the full height and every other is its count times the same scale", () => {
    const l = layoutFunnel(stages, O);
    expect(l[0].height).toBeCloseTo(200, 9);
    const scale = funnelScale(stages, 200);
    l.forEach((s, i) => expect(s.height).toBeCloseTo(stages[i].count * scale, 9));
    // Every pillar hangs from the same line, so no baseline moves.
    expect(new Set(l.map((s) => s.top))).toEqual(new Set([40]));
  });

  it("splits each pillar into those who reached the next stage and those who did not, and the two add up", () => {
    const l = layoutFunnel(stages, O);
    for (let i = 0; i < 3; i++) {
      expect(l[i].wentOn).toBe(stages[i + 1].count);
      expect(l[i].wentOn + l[i].didNot).toBe(stages[i].count);
      expect(l[i].wentH + l[i].didNotH).toBeCloseTo(l[i].height, 9);
      // The trunk is as thick as the next pillar, so it meets it exactly.
      expect(l[i].wentH).toBeCloseTo(l[i + 1].height, 9);
    }
    expect(l[3].next).toBeNull();
    expect(l[3].wentOn).toBe(0);
    expect(l[3].didNot).toBe(0);
    // The last stage has nothing to split, so it has no slice that did not go on.
    expect(l[3].didNotH).toBe(0);
  });

  it("holds a later stage that reads higher than the one before it, so the slices still add up", () => {
    const l = layoutFunnel([{ stage: "A", count: 100 }, { stage: "B", count: 140 }], O);
    expect(l[0].wentOn).toBe(100);
    expect(l[0].didNot).toBe(0);
    expect(l[0].wentH + l[0].didNotH).toBeCloseTo(l[0].height, 9);
  });

  it("draws nothing when nobody reached the first stage", () => {
    const l = layoutFunnel([{ stage: "A", count: 0 }, { stage: "B", count: 0 }], O);
    expect(funnelScale([{ stage: "A", count: 0 }], 200)).toBe(0);
    for (const s of l) expect([s.height, s.wentH, s.didNotH]).toEqual([0, 0, 0]);
  });

  it("keeps thickness proportional to count for any counts, with the two slices always adding up", () => {
    const rand = lcg(11);
    for (let t = 0; t < 200; t++) {
      const first = 1 + Math.floor(rand() * 1_000_000);
      const counts = [first, ...Array.from({ length: 3 }, () => Math.floor(rand() * first * 1.2))];
      const input = counts.map((count, i) => ({ stage: `S${i}`, count }));
      const l = layoutFunnel(input, O);
      const scale = funnelScale(input, O.maxHeight);
      l.forEach((s, i) => {
        expect(s.height).toBeCloseTo(counts[i] * scale, 6);
        expect(s.wentOn + s.didNot).toBe(i < 3 ? counts[i] : 0);
        expect(s.wentH).toBeGreaterThanOrEqual(0);
        expect(s.didNotH).toBeGreaterThanOrEqual(-1e-9);
      });
    }
  });

  it("writes a band path that stays between its two edges", () => {
    const p = bandPath(10, 20, 60, 110, 20, 50);
    expect(p.startsWith("M 10 20")).toBe(true);
    expect(p.endsWith("Z")).toBe(true);
    const nums = (p.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...nums)).toBeLessThanOrEqual(110);
  });
});
