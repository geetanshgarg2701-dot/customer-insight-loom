import { describe, expect, it } from "vitest";
import { stageCountsFromFlow, whatIf, type StageCount } from "./whatif";

// 1,000 people, 500 reach Product, 250 reach Cart, 100 purchase. Conversions are 50 percent, 50 percent and 40 percent.
const stages: StageCount[] = [
  { stage: "Visit", count: 1000 },
  { stage: "Product", count: 500 },
  { stage: "Cart", count: 250 },
  { stage: "Purchase", count: 100 },
];

describe("whatIf", () => {
  it("raises one step and carries the gain through the later steps at their current rates", () => {
    // Product to Cart goes from 50 to 60 percent: 300 reach the cart, and 40 percent of them purchase, so 120.
    const r = whatIf(stages, { fromStep: 1, points: 10 });
    expect(r.step).toBe("Product to Cart");
    expect(r.currentRate).toBeCloseTo(0.5, 10);
    expect(r.newRate).toBeCloseTo(0.6, 10);
    expect(r.counts.map((c) => c.count)).toEqual([1000, 500, 300, 120]);
    expect(r.extraAtEnd).toBeCloseTo(20, 10);
    expect(r.extraShare).toBeCloseTo(0.2, 10);
  });

  it("leaves everything alone at zero points", () => {
    const r = whatIf(stages, { fromStep: 0, points: 0 });
    expect(r.counts.map((c) => c.count)).toEqual([1000, 500, 250, 100]);
    expect(r.extraAtEnd).toBe(0);
  });

  it("improving the first step carries through every later step", () => {
    // Visit to Product 50 to 70 percent: 700, then 350, then 140.
    const r = whatIf(stages, { fromStep: 0, points: 20 });
    expect(r.counts.map((c) => c.count)).toEqual([1000, 700, 350, 140]);
    expect(r.extraAtEnd).toBeCloseTo(40, 10);
  });

  it("can show a worse step, and never goes below zero people", () => {
    const worse = whatIf(stages, { fromStep: 2, points: -10 });
    expect(worse.extraAtEnd).toBeCloseTo(-25, 10);
    const gone = whatIf(stages, { fromStep: 2, points: -100 });
    expect(gone.newRate).toBe(0);
    expect(gone.counts[3].count).toBe(0);
  });

  it("caps the new rate at 100 percent", () => {
    const r = whatIf(stages, { fromStep: 2, points: 80 });
    expect(r.newRate).toBe(1);
    expect(r.counts[3].count).toBeCloseTo(250, 10);
  });

  it("says plainly what it assumes, and is not a forecast", () => {
    const r = whatIf(stages, { fromStep: 1, points: 10 });
    expect(r.note).toMatch(/assumes/);
    expect(r.note).toMatch(/not a forecast/);
    expect(r.note).not.toMatch(/[—()]/);
  });

  it("handles a step nobody reached without dividing by zero", () => {
    const empty = whatIf(
      [
        { stage: "Visit", count: 100 },
        { stage: "Product", count: 0 },
        { stage: "Cart", count: 0 },
        { stage: "Purchase", count: 0 },
      ],
      { fromStep: 1, points: 10 },
    );
    expect(empty.counts.map((c) => c.count)).toEqual([100, 0, 0, 0]);
    expect(empty.extraAtEnd).toBe(0);
  });

  it("refuses a step that does not exist or a point change that is not a number", () => {
    expect(() => whatIf(stages, { fromStep: 3, points: 5 })).toThrow(RangeError);
    expect(() => whatIf(stages, { fromStep: -1, points: 5 })).toThrow(RangeError);
    expect(() => whatIf(stages, { fromStep: 0, points: Number.NaN })).toThrow(RangeError);
    expect(() => whatIf(stages.slice(0, 1), { fromStep: 0, points: 5 })).toThrow(RangeError);
  });
});

describe("stageCountsFromFlow", () => {
  it("reads the people at each main stage from the flow, and ignores drop off nodes", () => {
    const flow = [
      { source: "1. Visit", target: "2. Product", value: 500 },
      { source: "1. Visit", target: "Dropped after 1. Visit", value: 500 },
      { source: "2. Product", target: "3. Cart", value: 250 },
      { source: "2. Product", target: "Dropped after 2. Product", value: 250 },
      { source: "3. Cart", target: "4. Purchase", value: 100 },
      { source: "3. Cart", target: "Dropped after 3. Cart", value: 150 },
    ];
    expect(stageCountsFromFlow(flow)).toEqual(stages);
  });

  it("gives nothing for an empty flow", () => {
    expect(stageCountsFromFlow([])).toEqual([]);
  });
});
