import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JOURNEY_STEPS, syntheticJourneys, type JourneyRow } from "../demo/journeys";
import { createNodeEngine } from "../intake/testing/node-engine";
import type { SqlEngine } from "../intake/types";
import { MIN_GROUP } from "./compare";
import { loadJourneys } from "./crossfilter";
import { exampleJourney } from "./replay";

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 6, 1, 8, 0, 0);

/** A customer on the main steps with the given hours between them, entering `enter` hours after T0. */
function person(segment: JourneyRow["segment"], enter: number, gaps: number[], detour = false): JourneyRow {
  const main = JOURNEY_STEPS.slice(0, gaps.length + 1) as string[];
  const path = detour ? [main[0], "Search", ...main.slice(1)] : main;
  let t = T0 + enter * HOUR;
  const times = [new Date(t).toISOString()];
  for (let i = 1; i < path.length; i++) {
    t += (detour && i === 1 ? 0.5 : gaps[detour && i > 1 ? i - 2 : i - 1]) * HOUR;
    times.push(new Date(t).toISOString());
  }
  return { segment, channel: "ads", steps: JOURNEY_STEPS.map((s, i) => (i < main.length ? s : null)), reached: main[main.length - 1], path, times };
}

describe("exampleJourney on paths worked out by hand", () => {
  // 40 customers who bought. The first, customer 0, took 1, 2 and 24 hours. The second, customer 1, used Search first.
  // 3 customers who left at Cart, so too few to replay.
  const rows = [
    person("new", 0, [1, 2, 24]),
    person("new", 5, [1, 3, 48], true),
    ...Array.from({ length: 38 }, (_, i) => person("returning", i, [1, 1, 1])),
    ...Array.from({ length: 3 }, () => person("new", 0, [1, 1])),
  ];
  let e: SqlEngine;
  beforeAll(async () => {
    e = await createNodeEngine({ isolated: true });
    await loadJourneys(e, "journeys", rows);
  });
  afterAll(async () => {
    await e.close?.();
  });

  it("returns one customer's events in time order, with the time since entry and since the step before", async () => {
    const j = await exampleJourney(e, "journeys", {}, { reached: "Purchase", offset: 0 });
    expect(j.hidden).toBe(false);
    expect(j.events.map((x) => x.step)).toEqual(["Visit", "Product", "Cart", "Purchase"]);
    expect(j.events.map((x) => x.at)).toEqual([
      "2026-07-01T08:00:00.000Z",
      "2026-07-01T09:00:00.000Z",
      "2026-07-01T11:00:00.000Z",
      "2026-07-02T11:00:00.000Z",
    ]);
    expect(j.events.map((x) => x.hoursSinceEntry)).toEqual([0, 1, 3, 27]);
    expect(j.events.map((x) => x.hoursSincePrevious)).toEqual([null, 1, 2, 24]);
  });

  it("keeps detours in place, so a replay shows the real route and not only the main steps", async () => {
    const j = await exampleJourney(e, "journeys", {}, { reached: "Purchase", offset: 1 });
    expect(j.events.map((x) => x.step)).toEqual(["Visit", "Search", "Product", "Cart", "Purchase"]);
    expect(j.events[1].hoursSincePrevious).toBeCloseTo(0.5, 9);
  });

  it("walks through the matching customers in a fixed order, wraps around, and says where it is", async () => {
    const a = await exampleJourney(e, "journeys", {}, { reached: "Purchase", offset: 0 });
    expect(a.position).toBe(1);
    expect(a.of).toBe(40);
    const last = await exampleJourney(e, "journeys", {}, { reached: "Purchase", offset: 39 });
    expect(last.position).toBe(40);
    const wrapped = await exampleJourney(e, "journeys", {}, { reached: "Purchase", offset: 40 });
    expect(wrapped.position).toBe(1);
    expect(wrapped.events).toEqual(a.events);
    const again = await exampleJourney(e, "journeys", {}, { reached: "Purchase", offset: 0 });
    expect(again).toEqual(a);
  });

  it("is anonymous: a plain made up label, no email or name anywhere, and it says it is synthetic", async () => {
    const j = await exampleJourney(e, "journeys", {}, { reached: "Purchase", offset: 0 });
    expect(j.label).toBe("Synthetic customer 0");
    expect(JSON.stringify(j)).not.toMatch(/@/);
    expect(Object.keys(j).sort()).toEqual(["channel", "events", "groupSize", "hidden", "label", "minGroup", "of", "position", "segment"]);
  });

  it("refuses to show a single path when the group behind it is under the minimum, and shows no events", async () => {
    const j = await exampleJourney(e, "journeys", {}, { reached: "Cart", offset: 0 });
    expect(j.groupSize).toBe(3);
    expect(j.minGroup).toBe(MIN_GROUP);
    expect(j.hidden).toBe(true);
    expect(j.events).toEqual([]);
    expect(j.label).toBe("Hidden, only 3 people match and the minimum is 30");
    expect(j.segment).toBeNull();
    expect(j.channel).toBeNull();
  });

  it("honors the other filters, and ignores a filter on the furthest step because the choice of outcome sets it", async () => {
    const j = await exampleJourney(e, "journeys", { segment: ["returning"], reached: ["Visit"] }, { reached: "Purchase", offset: 0 });
    expect(j.of).toBe(38);
    expect(j.segment).toBe("returning");
  });

  it("says nobody matches when there is no customer, instead of failing", async () => {
    const j = await exampleJourney(e, "journeys", {}, { reached: "Visit", offset: 0 });
    expect(j.groupSize).toBe(0);
    expect(j.hidden).toBe(true);
    expect(j.events).toEqual([]);
  });

  it("refuses a bad outcome, a bad offset, or a bad table name", async () => {
    await expect(exampleJourney(e, "journeys", {}, { reached: "Refund", offset: 0 })).rejects.toThrow(RangeError);
    await expect(exampleJourney(e, "journeys", {}, { reached: "Purchase", offset: -1 })).rejects.toThrow(RangeError);
    await expect(exampleJourney(e, "journeys", {}, { reached: "Purchase", offset: 1.5 })).rejects.toThrow(RangeError);
    await expect(exampleJourney(e, "journeys; DROP TABLE x", {}, { reached: "Purchase", offset: 0 })).rejects.toThrow(RangeError);
  });
});

describe("exampleJourney against the generator", () => {
  const generated = syntheticJourneys(20_000, 11);
  let e: SqlEngine;
  beforeAll(async () => {
    e = await createNodeEngine({ isolated: true });
    await loadJourneys(e, "journeys", generated);
  }, 120_000);
  afterAll(async () => {
    await e.close?.();
  });

  it("returns exactly the generator's path and times for the customers it points at", async () => {
    const bought = generated.map((r, i) => ({ r, i })).filter((x) => x.r.reached === "Purchase");
    for (const offset of [0, 1, 7, 100]) {
      const j = await exampleJourney(e, "journeys", {}, { reached: "Purchase", offset });
      const mine = bought[offset];
      expect(j.label).toBe(`Synthetic customer ${mine.i}`);
      expect(j.events.map((x) => x.step)).toEqual(mine.r.path);
      expect(j.events.map((x) => x.at)).toEqual(mine.r.times);
      expect(j.of).toBe(bought.length);
      expect(j.segment).toBe(mine.r.segment);
    }
  });
});
