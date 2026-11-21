import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JOURNEY_STEPS, syntheticJourneys, type JourneyRow } from "../demo/journeys";
import { createNodeEngine } from "../intake/testing/node-engine";
import type { SqlEngine } from "../intake/types";
import { behindDetour, DETOURS } from "./behind";
import { MIN_GROUP } from "./compare";
import { loadJourneys } from "./crossfilter";

/** One person whose path is given in full, detours included. The main step columns are worked out from it. */
function walk(segment: JourneyRow["segment"], channel: JourneyRow["channel"], path: string[]): JourneyRow {
  const main = path.filter((s) => (JOURNEY_STEPS as readonly string[]).includes(s));
  const times = path.map((_, i) => new Date(Date.UTC(2026, 6, 1, i)).toISOString());
  return {
    segment,
    channel,
    steps: JOURNEY_STEPS.map((s) => (main.includes(s) ? s : null)),
    reached: main[main.length - 1],
    path,
    times,
  };
}
const many = (n: number, segment: JourneyRow["segment"], channel: JourneyRow["channel"], path: string[]) =>
  Array.from({ length: n }, () => walk(segment, channel, path));

describe("who is behind a detour, on counts worked out by hand", () => {
  // Who used Search:
  //   new and ads: 50 went on to Product, 10 stopped at Search. 60 in all.
  //   returning and email: 35 went on to Product, 5 stopped. 40 in all.
  //   vip and organic: 8 went on, 2 stopped. 10 in all, under 30, so hidden after merging.
  // Who used Support, after Cart:
  //   new and ads: 30 went on to Purchase, 12 stopped at Support. 42 in all.
  //   returning and email: 3 went on to Product again, an undesigned move, and 1 stopped. 4 in all, merged and hidden.
  // Plus 70 people who never used a detour, who must not appear.
  const rows = [
    ...many(50, "new", "ads", ["Visit", "Search", "Product", "Cart"]),
    ...many(10, "new", "ads", ["Visit", "Search"]),
    ...many(35, "returning", "email", ["Visit", "Search", "Product"]),
    ...many(5, "returning", "email", ["Visit", "Search"]),
    ...many(8, "vip", "organic", ["Visit", "Search", "Product", "Cart", "Purchase"]),
    ...many(2, "vip", "organic", ["Visit", "Search"]),
    ...many(30, "new", "ads", ["Visit", "Product", "Cart", "Support", "Purchase"]),
    ...many(12, "new", "ads", ["Visit", "Product", "Cart", "Support"]),
    ...many(3, "returning", "email", ["Visit", "Product", "Cart", "Support", "Product"]),
    ...many(1, "returning", "email", ["Visit", "Product", "Cart", "Support"]),
    ...many(70, "returning", "organic", ["Visit", "Product", "Cart", "Purchase"]),
  ];
  let e: SqlEngine;
  beforeAll(async () => {
    e = await createNodeEngine({ isolated: true });
    await loadJourneys(e, "journeys", rows);
  });
  afterAll(async () => {
    await e.close?.();
  });

  it("names the two detours and the step each one leads back to", () => {
    expect(DETOURS).toEqual([
      { step: "Search", next: "Product" },
      { step: "Support", next: "Purchase" },
    ]);
  });

  it("counts everyone who used Search, how many went on to Product, and how many stopped there", async () => {
    const b = await behindDetour(e, "journeys", {}, "Search");
    expect(b).toMatchObject({ step: "Search", next: "Product", reached: 110, movedOn: 93, left: 17, elsewhere: 0 });
  });

  it("counts an undesigned move after a detour on its own, not as going on and not as leaving", async () => {
    const b = await behindDetour(e, "journeys", {}, "Support");
    expect(b).toMatchObject({ step: "Support", next: "Purchase", reached: 46, movedOn: 30, left: 13, elsewhere: 3 });
  });

  it("lists groups largest first, and merges and hides groups under the minimum", async () => {
    const b = await behindDetour(e, "journeys", {}, "Search");
    expect(b.minGroup).toBe(MIN_GROUP);
    expect(b.groups.filter((g) => !g.merged).map((g) => [g.segment, g.channel, g.reached, g.movedOn, g.left])).toEqual([
      ["new", "ads", 60, 50, 10],
      ["returning", "email", 40, 35, 5],
    ]);
    const merged = b.groups.find((g) => g.merged)!;
    expect(merged).toMatchObject({ hidden: true, reached: null, movedOn: null, left: null, rate: null, mergedGroups: 1 });
    expect(b.groups.some((g) => g.segment === "vip")).toBe(false);
  });

  it("follows the filters", async () => {
    const b = await behindDetour(e, "journeys", { segment: ["new"] }, "Support");
    expect(b).toMatchObject({ reached: 42, movedOn: 30, left: 12, elsewhere: 0 });
  });

  it("refuses a step that is not a detour, and a bad table name", async () => {
    await expect(behindDetour(e, "journeys", {}, "Cart" as never)).rejects.toThrow(/not a detour/);
    await expect(behindDetour(e, "journeys; drop table x", {}, "Search")).rejects.toThrow(/Table name/);
  });
});

describe("who is behind a detour, against the generator", () => {
  const rows = syntheticJourneys(20_000, 11);
  let e: SqlEngine;
  beforeAll(async () => {
    e = await createNodeEngine({ isolated: true });
    await loadJourneys(e, "journeys", rows);
  });
  afterAll(async () => {
    await e.close?.();
  });

  it.each(["Search", "Support"] as const)("matches a count made straight from the generated paths for %s", async (step) => {
    const next = step === "Search" ? "Product" : "Purchase";
    let reached = 0;
    let movedOn = 0;
    let left = 0;
    for (const r of rows) {
      const i = r.path.indexOf(step);
      if (i < 0) continue;
      reached++;
      if (i === r.path.length - 1) left++;
      else if (r.path[i + 1] === next) movedOn++;
    }
    const b = await behindDetour(e, "journeys", {}, step);
    expect(reached).toBeGreaterThan(MIN_GROUP);
    expect(b).toMatchObject({ reached, movedOn, left, elsewhere: reached - movedOn - left });
    const shownTotal = b.groups.reduce((n, g) => n + (g.reached ?? 0), 0);
    expect(shownTotal).toBeLessThanOrEqual(reached);
  });
});

describe("who is behind a detour, when someone uses it twice", () => {
  // Support, back to Product, Cart, Support again, then Purchase. The first visit is read: its very next event is Product,
  // which the design does not show, so the person counts as elsewhere, not as going on to Purchase.
  const rows = [walk("new", "ads", ["Visit", "Product", "Cart", "Support", "Product", "Cart", "Support", "Purchase"])];
  let e: SqlEngine;
  beforeAll(async () => {
    e = await createNodeEngine({ isolated: true });
    await loadJourneys(e, "journeys", rows);
  });
  afterAll(async () => {
    await e.close?.();
  });

  it("reads the first visit and counts the person once", async () => {
    const b = await behindDetour(e, "journeys", {}, "Support");
    expect(b).toMatchObject({ reached: 1, movedOn: 0, left: 0, elsewhere: 1 });
  });
});
