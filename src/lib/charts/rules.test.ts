import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JOURNEY_STEPS, syntheticJourneys, JOURNEYS_AS_OF, type JourneyRow } from "../demo/journeys";
import { createNodeEngine } from "../intake/testing/node-engine";
import type { SqlEngine } from "../intake/types";
import { loadJourneys } from "./crossfilter";
import { exitRules, WAIT_CHOICES, waitAfter } from "./rules";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 6, 1);
const iso = (ms: number) => new Date(ms).toISOString();

/** A customer who reached the first `days.length` main steps, at the given offsets in days from July 1, 2026. */
function person(channel: JourneyRow["channel"], offsets: number[]): JourneyRow {
  const path = JOURNEY_STEPS.slice(0, offsets.length) as string[];
  return {
    segment: "new",
    channel,
    steps: JOURNEY_STEPS.map((s, i) => (i < offsets.length ? s : null)),
    reached: path[path.length - 1],
    path,
    times: offsets.map((d) => iso(T0 + d * DAY)),
  };
}

describe("waitAfter and exitRules on dates worked out by hand", () => {
  // The cutoff is July 21, day 20.
  // Reached Cart (offset in days of Visit, Product, Cart, Purchase):
  //   A: ads,   0 1 2 3   Cart on day 2, Purchase day 3, one day later.        Within a 3 day wait.
  //   B: ads,   0 1 2 5   Cart day 2, Purchase day 5, exactly 3 days later.     Within, since the edge counts.
  //   C: email, 0 1 2 6   Cart day 2, Purchase day 6, 4 days later.             Later than the wait.
  //   D: email, 0 1 3     Cart day 3, no Purchase. Wait ends day 6, cutoff 20.   Outlasted the wait.
  //   E: ads,   0 1 19    Cart day 19, no Purchase. Wait ends day 22, cutoff 20. Still waiting.
  //   F: ads,   0 1 18    Cart day 18, no Purchase. Wait ends day 21, cutoff 20. Still waiting.
  //   G: ads,   0 1 17    Cart day 17, no Purchase. Wait ends day 20 = cutoff.   Wait is over: outlasted.
  // Never reached Cart:
  //   H: email, 0 15      Product day 15, last event day 15.
  //   I: email, 0         Visit day 0, last event day 0.
  const rows = [
    person("ads", [0, 1, 2, 3]),
    person("ads", [0, 1, 2, 5]),
    person("email", [0, 1, 2, 6]),
    person("email", [0, 1, 3]),
    person("ads", [0, 1, 19]),
    person("ads", [0, 1, 18]),
    person("ads", [0, 1, 17]),
    person("email", [0, 15]),
    person("email", [0]),
  ];
  const asOf = iso(T0 + 20 * DAY);
  let e: SqlEngine;
  beforeAll(async () => {
    e = await createNodeEngine({ isolated: true });
    await loadJourneys(e, "j", rows);
  });
  afterAll(async () => e.close?.());

  it("splits everyone who reached the Cart by what they did with a 3 day wait, and the parts add up", async () => {
    const w = await waitAfter(e, "j", {}, { stepIndex: 2, days: 3, asOf });
    expect(w).toMatchObject({ step: "Cart", next: "Purchase", days: 3, reached: 7, within: 2, later: 1, stillWaiting: 2, outlasted: 2 });
    expect(w.within + w.later + w.stillWaiting + w.outlasted).toBe(w.reached);
  });

  it("changes the split when the wait is longer", async () => {
    const w = await waitAfter(e, "j", {}, { stepIndex: 2, days: 7, asOf });
    // Within 7 days: A, B, C. Wait ends later than day 20 for E, F, G (day 24, 25, 24): still waiting. D: day 10, outlasted.
    expect(w).toMatchObject({ reached: 7, within: 3, later: 0, stillWaiting: 3, outlasted: 1 });
  });

  it("works for any step but the last, and follows the filters", async () => {
    const product = await waitAfter(e, "j", {}, { stepIndex: 1, days: 1, asOf });
    expect(product).toMatchObject({ step: "Product", next: "Cart", reached: 8 });
    const ads = await waitAfter(e, "j", { channel: ["ads"] }, { stepIndex: 2, days: 3, asOf });
    expect(ads).toMatchObject({ reached: 5, within: 2, later: 0, stillWaiting: 2, outlasted: 1 });
  });

  it("refuses the last step, a step that does not exist, a wait that is not above zero, and a bad table or cutoff", async () => {
    await expect(waitAfter(e, "j", {}, { stepIndex: 3, days: 3, asOf })).rejects.toThrow(RangeError);
    await expect(waitAfter(e, "j", {}, { stepIndex: -1, days: 3, asOf })).rejects.toThrow(RangeError);
    await expect(waitAfter(e, "j", {}, { stepIndex: 2, days: 0, asOf })).rejects.toThrow(RangeError);
    await expect(waitAfter(e, "j x", {}, { stepIndex: 2, days: 3, asOf })).rejects.toThrow(RangeError);
    await expect(waitAfter(e, "j", {}, { stepIndex: 2, days: 3, asOf: "soon" })).rejects.toThrow(RangeError);
  });

  it("splits everyone into reached the goal, inactive past the threshold, and still active, adding up to the total", async () => {
    // Last events on days: A 3, B 5, C 6, D 3, E 19, F 18, G 17, H 15, I 0. Goal reached: A, B, C.
    // A 14 day inactivity rule drops those whose last event was on or before day 6 (cutoff day 20 minus 14): D and I.
    const x = await exitRules(e, "j", {}, { inactiveDays: 14, asOf });
    expect(x).toEqual({ total: 9, goal: 3, inactive: 2, active: 4, inactiveDays: 14 });
    expect(x.goal + x.inactive + x.active).toBe(x.total);
  });

  it("counts a last event exactly at the threshold as inactive, and a shorter rule drops more", async () => {
    const x = await exitRules(e, "j", {}, { inactiveDays: 5, asOf });
    // Last event on or before day 15 is inactive: D day 3, H day 15, I day 0. Day 17, 18, 19 are active.
    expect(x).toMatchObject({ goal: 3, inactive: 3, active: 3 });
    // A longer rule drops fewer: 14 days gave 2 inactive, and 5 days gives 3.
    expect(x.inactive).toBeGreaterThan((await exitRules(e, "j", {}, { inactiveDays: 14, asOf })).inactive);
  });

  it("follows the filters, and refuses a threshold that is not above zero or a cutoff that is not a time", async () => {
    expect(await exitRules(e, "j", { channel: ["email"] }, { inactiveDays: 14, asOf })).toEqual({ total: 4, goal: 1, inactive: 2, active: 1, inactiveDays: 14 });
    await expect(exitRules(e, "j", {}, { inactiveDays: 0, asOf })).rejects.toThrow(RangeError);
    await expect(exitRules(e, "j", {}, { inactiveDays: 14, asOf: "soon" })).rejects.toThrow(RangeError);
    await expect(exitRules(e, "j x", {}, { inactiveDays: 14, asOf })).rejects.toThrow(RangeError);
  });

  it("offers a few choices of wait, in days", () => {
    expect([...WAIT_CHOICES]).toEqual([1, 3, 7]);
  });
});

describe("the rules on the synthetic journeys, against an independent count", () => {
  const rows = syntheticJourneys(5_000, 11);
  let e: SqlEngine;
  beforeAll(async () => {
    e = await createNodeEngine({ isolated: true });
    await loadJourneys(e, "j", rows);
  }, 60_000);
  afterAll(async () => e.close?.());

  it("matches a count made in plain code for a 3 day wait after the Cart", async () => {
    const w = await waitAfter(e, "j", {}, { stepIndex: 2, days: 3, asOf: JOURNEYS_AS_OF });
    const atCart = rows.filter((r) => r.steps[2] !== null);
    const at = (r: JourneyRow, step: string) => Date.parse(r.times[r.path.indexOf(step)]);
    expect(w.reached).toBe(atCart.length);
    expect(w.within).toBe(atCart.filter((r) => r.steps[3] !== null && at(r, "Purchase") - at(r, "Cart") <= 3 * DAY).length);
    expect(w.later).toBe(atCart.filter((r) => r.steps[3] !== null && at(r, "Purchase") - at(r, "Cart") > 3 * DAY).length);
    // The demo cutoff is long after the last event, so nobody is still waiting.
    expect(w.stillWaiting).toBe(0);
    expect(w.outlasted).toBe(atCart.filter((r) => r.steps[3] === null).length);
  });

  it("matches a count made in plain code for a 30 day inactivity rule", async () => {
    const x = await exitRules(e, "j", {}, { inactiveDays: 30, asOf: JOURNEYS_AS_OF });
    const last = (r: JourneyRow) => Date.parse(r.times[r.times.length - 1]);
    const cutoff = Date.parse(JOURNEYS_AS_OF);
    expect(x.total).toBe(rows.length);
    expect(x.goal).toBe(rows.filter((r) => r.steps[3] !== null).length);
    expect(x.inactive).toBe(rows.filter((r) => r.steps[3] === null && last(r) + 30 * DAY <= cutoff).length);
  });
});
