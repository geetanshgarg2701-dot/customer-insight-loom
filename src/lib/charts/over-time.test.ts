import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JOURNEY_STEPS, syntheticJourneys, type JourneyRow } from "../demo/journeys";
import { createNodeEngine } from "../intake/testing/node-engine";
import type { SqlEngine } from "../intake/types";
import { loadJourneys } from "./crossfilter";
import { beforeAfter, placeMarkers, stepsOverTime } from "./over-time";

const at = (day: number, hour = 9) => new Date(Date.UTC(2026, 6, 1 + day, hour)).toISOString();

/** A customer who reaches each main step on the given days after July 1, 2026. */
function person(channel: JourneyRow["channel"], days: number[]): JourneyRow {
  const path = JOURNEY_STEPS.slice(0, days.length) as string[];
  return {
    segment: "new",
    channel,
    steps: JOURNEY_STEPS.map((s, i) => (i < days.length ? s : null)),
    reached: path[path.length - 1],
    path,
    times: days.map((d) => at(d)),
  };
}

describe("stepsOverTime on dates worked out by hand", () => {
  // A: ads, Visit July 1, Product July 2, Cart July 2, Purchase July 4.
  // B: email, Visit July 2, Product July 3.
  // C: ads, Visit July 3, Product July 3, Cart July 5.
  // The data runs from July 1 to July 5, five days.
  const rows = [person("ads", [0, 1, 1, 3]), person("email", [1, 2]), person("ads", [2, 2, 4])];
  let e: SqlEngine;
  beforeAll(async () => {
    e = await createNodeEngine({ isolated: true });
    await loadJourneys(e, "j", rows);
  });
  afterAll(async () => e.close?.());

  it("lists every day from the first event to the last", async () => {
    const s = await stepsOverTime(e, "j", {});
    expect(s.days).toEqual(["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05"]);
  });

  it("counts, for each step and day, how many people reached it that day and by the end of that day", async () => {
    const s = await stepsOverTime(e, "j", {});
    expect(s.daily).toEqual([
      [1, 1, 1, 0, 0],
      [0, 1, 2, 0, 0],
      [0, 1, 0, 0, 1],
      [0, 0, 0, 1, 0],
    ]);
    expect(s.cumulative).toEqual([
      [1, 2, 3, 3, 3],
      [0, 1, 3, 3, 3],
      [0, 1, 1, 1, 2],
      [0, 0, 0, 1, 1],
    ]);
  });

  it("applies the page filters but keeps the same days, so the axis does not jump when a filter changes", async () => {
    const s = await stepsOverTime(e, "j", { channel: ["email"] });
    expect(s.days).toHaveLength(5);
    expect(s.cumulative[0]).toEqual([0, 1, 1, 1, 1]);
    expect(s.cumulative[3]).toEqual([0, 0, 0, 0, 0]);
  });

  it("refuses a bad table name", async () => {
    await expect(stepsOverTime(e, "j x", {})).rejects.toThrow(RangeError);
  });
});

describe("stepsOverTime on the synthetic journeys", () => {
  const rows = syntheticJourneys(5_000, 11);
  let e: SqlEngine;
  beforeAll(async () => {
    e = await createNodeEngine({ isolated: true });
    await loadJourneys(e, "j", rows);
  }, 60_000);
  afterAll(async () => e.close?.());

  it("ends with the same totals as counting the generator's rows", async () => {
    const s = await stepsOverTime(e, "j", {});
    JOURNEY_STEPS.forEach((_, k) => {
      expect(s.cumulative[k].at(-1)).toBe(rows.filter((r) => r.steps[k] !== null).length);
      expect(s.daily[k].reduce((a, b) => a + b, 0)).toBe(s.cumulative[k].at(-1));
    });
  });

  it("matches an independent count of purchases by day", async () => {
    const s = await stepsOverTime(e, "j", {});
    const byDay = new Map<string, number>();
    for (const r of rows) {
      const i = r.path.indexOf("Purchase");
      if (i < 0) continue;
      const d = r.times[i].slice(0, 10);
      byDay.set(d, (byDay.get(d) ?? 0) + 1);
    }
    s.days.forEach((d, i) => expect(s.daily[3][i], d).toBe(byDay.get(d) ?? 0));
  });
});

describe("placeMarkers", () => {
  const days = ["2026-07-01", "2026-07-02", "2026-07-03"];

  it("puts a launch on its UTC day when it falls inside the data, and lists the rest as outside, leaving out unlaunched entries", () => {
    const m = placeMarkers(
      [
        { id: "a", title: "In range", launchedAt: "2026-07-02T23:30:00.000Z" },
        { id: "b", title: "Before", launchedAt: "2026-06-30T12:00:00.000Z" },
        { id: "c", title: "After", launchedAt: "2026-11-19T12:00:00.000Z" },
        { id: "d", title: "Draft", launchedAt: null },
      ],
      days,
    );
    expect(m.inRange).toEqual([{ id: "a", title: "In range", day: "2026-07-02", index: 1 }]);
    expect(m.outside.map((x) => [x.id, x.day])).toEqual([
      ["b", "2026-06-30"],
      ["c", "2026-11-19"],
    ]);
  });
});

describe("beforeAfter", () => {
  // Purchases a day: 2, 4, 6, 8, 10, 12. A marker on the fourth day.
  const daily = [[0], [0], [0], [2, 4, 6, 8, 10, 12]];

  it("averages the days before the marker and the days from the marker on, within the window", () => {
    const r = beforeAfter(daily, 3, 3, 2)!;
    expect(r.before).toEqual({ days: 2, total: 10, perDay: 5 });
    expect(r.after).toEqual({ days: 2, total: 18, perDay: 9 });
  });

  it("uses fewer days at the edges and says how many, and gives null when one side has none", () => {
    expect(beforeAfter(daily, 3, 1, 7)!.before).toEqual({ days: 1, total: 2, perDay: 2 });
    expect(beforeAfter(daily, 3, 0, 7)).toBeNull();
  });

  it("refuses a step or window that does not exist", () => {
    expect(() => beforeAfter(daily, 4, 2, 7)).toThrow(RangeError);
    expect(() => beforeAfter(daily, 3, 2, 0)).toThrow(RangeError);
  });
});
