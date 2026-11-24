import { describe, expect, it } from "vitest";
import { MIN_BAND_PX, finalStage, layoutBands, stageFromWait, withDetour, type StageParts } from "./butterfly";
import type { WaitResult } from "./rules";

const wait = (o: Partial<WaitResult> = {}): WaitResult => ({
  step: "Cart",
  next: "Purchase",
  days: 3,
  reached: 100,
  within: 50,
  later: 10,
  stillWaiting: 5,
  outlasted: 35,
  ...o,
});

/** A small deterministic generator, so a property test gives the same cases every run. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

describe("a stage's three parts", () => {
  it("are those who went on, those who dropped off and those still waiting, and add up to the intake", () => {
    const s = stageFromWait(wait());
    expect(s).toEqual({ stage: "Cart", next: "Purchase", intake: 100, wentOn: 60, droppedOff: 35, stillWaiting: 5, via: 0 });
    expect(s.wentOn + s.droppedOff + s.stillWaiting).toBe(s.intake);
  });

  it("add up to the intake for any counts that the wait itself adds up", () => {
    const next = lcg(11);
    for (let i = 0; i < 500; i++) {
      const within = Math.floor(next() * 5000);
      const later = Math.floor(next() * 2000);
      const stillWaiting = Math.floor(next() * 300);
      const outlasted = Math.floor(next() * 4000);
      const s = stageFromWait(wait({ within, later, stillWaiting, outlasted, reached: within + later + stillWaiting + outlasted }));
      expect(s.wentOn + s.droppedOff + s.stillWaiting).toBe(s.intake);
    }
  });

  it("are refused, with the stage named, when they do not add up", () => {
    expect(() => stageFromWait(wait({ reached: 101 }))).toThrow(/Cart.*do not add up/);
    expect(() => stageFromWait(wait({ within: 51 }))).toThrow(RangeError);
  });

  it("are refused when a count is not a whole number or is negative", () => {
    expect(() => stageFromWait(wait({ stillWaiting: -5, outlasted: 45 }))).toThrow(RangeError);
    expect(() => stageFromWait(wait({ within: 50.5, later: 9.5 }))).toThrow(RangeError);
  });

  it("have a final stage with an intake and nothing leaving it", () => {
    expect(finalStage("Purchase", 16_294)).toEqual({ stage: "Purchase", next: null, intake: 16_294, wentOn: 0, droppedOff: 0, stillWaiting: 0, via: 0 });
  });
});

describe("the band layout", () => {
  const stages: StageParts[] = [
    stageFromWait(wait({ step: "Visit", next: "Product", reached: 1000, within: 600, later: 100, stillWaiting: 0, outlasted: 300 })),
    stageFromWait(wait({ step: "Product", next: "Cart", reached: 700, within: 300, later: 50, stillWaiting: 20, outlasted: 330 })),
    finalStage("Cart", 350),
  ];
  const opts = { maxHeight: 200, centerY: 250, columnGap: 300, pillarWidth: 28 };

  it("sizes each stage's pillar by its intake, the first stage taking the full height", () => {
    const [a, b, c] = layoutBands(stages, opts);
    expect(a.height).toBeCloseTo(200, 6);
    expect(b.height).toBeCloseTo(140, 6);
    expect(c.height).toBeCloseTo(70, 6);
  });

  it("makes each band as thick as its count says, on one scale for the whole flow", () => {
    const [a, b] = layoutBands(stages, opts);
    const scale = 200 / 1000;
    expect(a.wentOnH).toBeCloseTo(700 * scale, 6);
    expect(a.droppedH).toBeCloseTo(300 * scale, 6);
    expect(b.stillWaitingH).toBeCloseTo(20 * scale, 6);
    // Equal counts in two stages are equal thicknesses.
    expect(a.droppedH / 300).toBeCloseTo(b.droppedH / 330, 6);
  });

  it("makes the three bands of a stage fill its pillar exactly", () => {
    for (const s of layoutBands(stages, opts).slice(0, 2)) expect(s.stillWaitingH + s.wentOnH + s.droppedH).toBeCloseTo(s.height, 6);
  });

  it("makes the trunk leaving a stage as thick as the next stage's pillar when the next intake is what went on", () => {
    const [a, b] = layoutBands(stages, opts);
    expect(a.wentOnH).toBeCloseTo(b.height, 6);
  });

  it("draws a band of nothing as nothing, and any real count as at least a hairline", () => {
    const [a] = layoutBands(stages, opts);
    expect(a.stillWaitingH).toBe(0);
    const tiny = layoutBands([stageFromWait(wait({ reached: 1_000_000, within: 999_999, later: 0, stillWaiting: 1, outlasted: 0 })), finalStage("Purchase", 999_999)], opts)[0];
    expect(tiny.stillWaitingH).toBeGreaterThanOrEqual(MIN_BAND_PX);
  });

  it("puts the three exits in order down the pillar: waiting on top, the trunk in the middle, dropped off below, all inside it", () => {
    for (const s of layoutBands(stages, opts).slice(0, 2)) {
      expect(s.waitY).toBeLessThanOrEqual(s.trunkY);
      expect(s.trunkY).toBeLessThanOrEqual(s.dropY);
      for (const y of [s.waitY, s.trunkY, s.dropY]) {
        expect(y).toBeGreaterThanOrEqual(s.top - 1e-9);
        expect(y).toBeLessThanOrEqual(s.top + s.height + 1e-9);
      }
    }
  });

  it("centers every pillar on one line, spaces them evenly, and gives the last stage no bands", () => {
    const laid = layoutBands(stages, opts);
    for (const s of laid) expect(s.top + s.height / 2).toBeCloseTo(250, 6);
    expect(laid.map((s) => s.x)).toEqual([0, 300, 600]);
    const last = laid[2];
    expect([last.stillWaitingH, last.wentOnH, last.droppedH]).toEqual([0, 0, 0]);
  });

  it("draws nothing for a flow nobody entered", () => {
    const laid = layoutBands([stageFromWait(wait({ reached: 0, within: 0, later: 0, stillWaiting: 0, outlasted: 0 })), finalStage("Purchase", 0)], opts);
    for (const s of laid) expect(s.height).toBe(0);
    expect(JSON.stringify(laid)).not.toMatch(/NaN|Infinity/);
  });
});

describe("detours inside the trunk", () => {
  const base = stageFromWait(wait({ step: "Visit", next: "Product", reached: 1000, within: 600, later: 100, stillWaiting: 0, outlasted: 300 }));
  const opts = { maxHeight: 200, centerY: 250, columnGap: 300, pillarWidth: 28 };

  it("splits the trunk into a detour part and a direct part that add up to it", () => {
    const [a] = layoutBands([withDetour(base, 280), finalStage("Product", 700)], opts);
    expect(a.detourH).toBeCloseTo(280 * 0.2, 6);
    expect(a.directH).toBeCloseTo(420 * 0.2, 6);
    expect(a.detourH + a.directH).toBeCloseTo(a.wentOnH, 6);
  });

  it("puts the detour part above the direct part, both inside the trunk", () => {
    const [a] = layoutBands([withDetour(base, 280), finalStage("Product", 700)], opts);
    expect(a.detourY).toBeLessThan(a.directY);
    expect(a.detourY).toBeGreaterThanOrEqual(a.top);
    expect(a.directY).toBeLessThanOrEqual(a.top + a.stillWaitingH + a.wentOnH);
  });

  it("has no detour part when nobody went through one", () => {
    const [a] = layoutBands([base, finalStage("Product", 700)], opts);
    expect(a.detourH).toBe(0);
    expect(a.directH).toBeCloseTo(a.wentOnH, 6);
  });

  it("refuses more people through a detour than went on", () => {
    expect(() => withDetour(base, 701)).toThrow(/detour/);
    expect(() => withDetour(base, -1)).toThrow(RangeError);
  });
});
