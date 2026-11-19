import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JOURNEY_STEPS, syntheticJourneys, type JourneyRow } from "../demo/journeys";
import { createNodeEngine } from "../intake/testing/node-engine";
import type { SqlEngine } from "../intake/types";
import { wilsonInterval } from "../stats/readout";
import { behindStep } from "./behind";
import { MIN_GROUP } from "./compare";
import { loadJourneys } from "./crossfilter";

function person(segment: JourneyRow["segment"], channel: JourneyRow["channel"], reached: number): JourneyRow {
  const path = JOURNEY_STEPS.slice(0, reached) as string[];
  const times = path.map((_, i) => new Date(Date.UTC(2026, 6, 1, i)).toISOString());
  return { segment, channel, steps: JOURNEY_STEPS.map((s, i) => (i < reached ? s : null)), reached: path[path.length - 1], path, times };
}
const many = (n: number, segment: JourneyRow["segment"], channel: JourneyRow["channel"], reached: number) =>
  Array.from({ length: n }, () => person(segment, channel, reached));

describe("behindStep on counts worked out by hand", () => {
  // Who reached Cart, the third step:
  //   new and ads: 100, of whom 60 bought.
  //   returning and email: 50, of whom 40 bought.
  //   vip and organic: 10, of whom 9 bought. vip and ads: 15, of whom 5 bought. Both under 30, so they are merged, and
  //   the merged 25 is still under 30, so its numbers are hidden.
  // Plus 7 new and ads people who stopped at Product, who never reached Cart and must not appear.
  const rows = [
    ...many(60, "new", "ads", 4),
    ...many(40, "new", "ads", 3),
    ...many(40, "returning", "email", 4),
    ...many(10, "returning", "email", 3),
    ...many(9, "vip", "organic", 4),
    ...many(1, "vip", "organic", 3),
    ...many(5, "vip", "ads", 4),
    ...many(10, "vip", "ads", 3),
    ...many(7, "new", "ads", 2),
  ];
  let e: SqlEngine;
  beforeAll(async () => {
    e = await createNodeEngine({ isolated: true });
    await loadJourneys(e, "journeys", rows);
  });
  afterAll(async () => {
    await e.close?.();
  });

  it("counts everyone who reached the step, and how many went on and left", async () => {
    const b = await behindStep(e, "journeys", {}, 2);
    expect(b.step).toBe("Cart");
    expect(b.next).toBe("Purchase");
    expect(b.reached).toBe(175);
    expect(b.movedOn).toBe(114);
    expect(b.left).toBe(61);
  });

  it("lists groups by segment and channel, largest first, with a Wilson interval on the rate of going on", async () => {
    const b = await behindStep(e, "journeys", {}, 2);
    const shown = b.groups.filter((g) => !g.merged);
    expect(shown.map((g) => [g.segment, g.channel, g.reached, g.movedOn, g.left])).toEqual([
      ["new", "ads", 100, 60, 40],
      ["returning", "email", 50, 40, 10],
    ]);
    const w = wilsonInterval(40, 50, 0.05);
    expect(shown[1].rate).toBeCloseTo(0.8, 12);
    expect(shown[1].low).toBeCloseTo(w.low, 12);
    expect(shown[1].high).toBeCloseTo(w.high, 12);
  });

  it("merges groups under the minimum into one row, and hides its numbers when the merged row is still too small", async () => {
    const b = await behindStep(e, "journeys", {}, 2);
    expect(b.minGroup).toBe(MIN_GROUP);
    const merged = b.groups.find((g) => g.merged)!;
    expect(merged.mergedGroups).toBe(2);
    expect(merged.hidden).toBe(true);
    expect(merged.reached).toBeNull();
    expect(merged.movedOn).toBeNull();
    expect(merged.rate).toBeNull();
    expect(merged.label).toBe("2 smaller groups, merged, under 30 people in total, so their numbers are hidden");
    // The step totals still include them, so nothing silently disappears.
    expect(b.reached).toBe(100 + 50 + 25);
  });

  it("shows the merged row's numbers when the merged groups together reach the minimum", async () => {
    const e2 = await createNodeEngine({ isolated: true });
    await loadJourneys(e2, "journeys", [...rows, ...many(20, "vip", "email", 4)]);
    const b = await behindStep(e2, "journeys", {}, 2);
    const merged = b.groups.find((g) => g.merged)!;
    expect(merged.mergedGroups).toBe(3);
    expect(merged.hidden).toBe(false);
    expect(merged.reached).toBe(45);
    expect(merged.movedOn).toBe(34);
    expect(merged.label).toBe("3 smaller groups, merged");
    await e2.close?.();
  });

  it("has nothing to go on to after the last step, and says so instead of showing a rate", async () => {
    const b = await behindStep(e, "journeys", {}, 3);
    expect(b.step).toBe("Purchase");
    expect(b.next).toBeNull();
    expect(b.reached).toBe(114);
    expect(b.movedOn).toBeNull();
    expect(b.groups.every((g) => g.rate === null)).toBe(true);
  });

  it("honors the other filters", async () => {
    const b = await behindStep(e, "journeys", { channel: ["ads"] }, 2);
    expect(b.reached).toBe(115);
    expect(b.groups.filter((g) => !g.merged).map((g) => g.segment)).toEqual(["new"]);
  });

  it("refuses a step that does not exist or a bad table name", async () => {
    await expect(behindStep(e, "journeys", {}, 4)).rejects.toThrow(RangeError);
    await expect(behindStep(e, "journeys", {}, -1)).rejects.toThrow(RangeError);
    await expect(behindStep(e, "journeys", {}, 1.5)).rejects.toThrow(RangeError);
    await expect(behindStep(e, "journeys; DROP TABLE x", {}, 1)).rejects.toThrow(RangeError);
  });
});

describe("behindStep on the generator, counted a second way", () => {
  const generated = syntheticJourneys(20_000, 11);
  let e: SqlEngine;
  beforeAll(async () => {
    e = await createNodeEngine({ isolated: true });
    await loadJourneys(e, "journeys", generated);
  }, 120_000);
  afterAll(async () => {
    await e.close?.();
  });

  it("matches a plain code count for every step and every group shown", async () => {
    for (let i = 0; i < JOURNEY_STEPS.length - 1; i++) {
      const b = await behindStep(e, "journeys", {}, i);
      const at = generated.filter((r) => r.steps[i] !== null);
      expect(b.reached).toBe(at.length);
      expect(b.movedOn).toBe(at.filter((r) => r.steps[i + 1] !== null).length);
      for (const g of b.groups.filter((x) => !x.merged)) {
        const mine = at.filter((r) => r.segment === g.segment && r.channel === g.channel);
        expect(g.reached, `${g.segment} ${g.channel}`).toBe(mine.length);
        expect(g.movedOn).toBe(mine.filter((r) => r.steps[i + 1] !== null).length);
      }
    }
  });

  it("puts the planted leak in view: new customers at the Cart go on far less often than returning ones", async () => {
    const b = await behindStep(e, "journeys", {}, 2);
    const rate = (segment: string) => {
      const list = b.groups.filter((g) => !g.merged && g.segment === segment);
      const reached = list.reduce((n, g) => n + (g.reached ?? 0), 0);
      return list.reduce((n, g) => n + (g.movedOn ?? 0), 0) / reached;
    };
    expect(rate("returning") - rate("new")).toBeGreaterThan(0.25);
  });
});
