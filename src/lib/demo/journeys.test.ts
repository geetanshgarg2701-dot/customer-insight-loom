import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  ENTRY_DAYS,
  GAP_MEAN_HOURS,
  JOURNEY_START,
  JOURNEY_STEPS,
  JOURNEYS_AS_OF,
  MAX_GAP_HOURS,
  SLOW_NEW_FACTOR,
  syntheticJourneys,
} from "./journeys";

describe("syntheticJourneys", () => {
  it("is identical for the same seed and different for another", () => {
    expect(syntheticJourneys(500, 7)).toEqual(syntheticJourneys(500, 7));
    expect(syntheticJourneys(500, 7)).not.toEqual(syntheticJourneys(500, 8));
  });

  it("starts everyone at the first step and records only steps that were reached in order", () => {
    for (const row of syntheticJourneys(2000, 1)) {
      expect(row.steps[0]).toBe(JOURNEY_STEPS[0]);
      const reached = row.steps.filter((s) => s !== null);
      expect(reached).toEqual(JOURNEY_STEPS.slice(0, reached.length));
      // Once a step is missing, every later step is missing too.
      const firstGap = row.steps.indexOf(null);
      if (firstGap >= 0) expect(row.steps.slice(firstGap).every((s) => s === null)).toBe(true);
      expect(row.reached).toBe(reached[reached.length - 1]);
    }
  });

  it("plants a known fact: new customers drop off at the cart much more than returning ones", () => {
    const rows = syntheticJourneys(60_000, 3);
    const rate = (segment: string) => {
      const atCart = rows.filter((r) => r.segment === segment && r.steps[2] !== null);
      return atCart.filter((r) => r.steps[3] === null).length / atCart.length;
    };
    expect(rate("new")).toBeGreaterThan(0.65);
    expect(rate("returning")).toBeLessThan(0.5);
    expect(rate("new") - rate("returning")).toBeGreaterThan(0.25);
  });

  it("records the full path, with a Search detour before Product and a Support detour after Cart", () => {
    const rows = syntheticJourneys(40_000, 4);
    for (const row of rows) {
      expect(row.path[0]).toBe("Visit");
      // Remove the detours and what is left is exactly the main steps that were reached.
      const main = row.path.filter((step) => step !== "Search" && step !== "Support");
      expect(main).toEqual(row.steps.filter((x) => x !== null));
      const search = row.path.indexOf("Search");
      if (search >= 0) expect(row.path[search + 1]).toBe("Product");
      const support = row.path.indexOf("Support");
      if (support >= 0) expect(row.path[support - 1]).toBe("Cart");
    }
    expect(rows.some((r) => r.path.includes("Search"))).toBe(true);
    expect(rows.some((r) => r.path.includes("Support"))).toBe(true);
  });

  it("plants known effects: Search visitors reach the cart more, and Support callers buy less", () => {
    const rows = syntheticJourneys(120_000, 6);
    const toCart = (withSearch: boolean) => {
      const atProduct = rows.filter((r) => r.path.includes("Product") && r.path.includes("Search") === withSearch);
      return atProduct.filter((r) => r.path.includes("Cart")).length / atProduct.length;
    };
    expect(toCart(true)).toBeGreaterThan(toCart(false) + 0.05);
    const buys = (withSupport: boolean) => {
      const atCart = rows.filter((r) => r.path.includes("Cart") && r.path.includes("Support") === withSupport);
      return atCart.filter((r) => r.path.includes("Purchase")).length / atCart.length;
    };
    expect(buys(true)).toBeLessThan(buys(false) - 0.1);
  });

  it("uses only reserved synthetic labels, never an email or a name", () => {
    const rows = syntheticJourneys(200, 2);
    for (const r of rows) expect(JSON.stringify(r)).not.toMatch(/@|\d{3}-\d{4}/);
  });
});

describe("timestamps on the synthetic journeys", () => {
  const HOUR = 3_600_000;
  const withoutTimes = (n: number, seed: number) =>
    syntheticJourneys(n, seed).map((r) => ({ channel: r.channel, segment: r.segment, steps: r.steps, reached: r.reached, path: r.path }));
  const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

  it("leaves every existing customer exactly as it was before timestamps were added", () => {
    // Checksums taken from the generator on 2026-11-18, before the change. Timestamps come from a separate stream.
    expect(sha(withoutTimes(20_000, 11))).toBe("4bf6382c490b00b07c21291c3b5d426ac23a5af5b8ddc566976d12e3aab1ee56");
    expect(sha(withoutTimes(5_000, 3))).toBe("dc05e2501fb1cbac6e786e183a01b1d67b87a56f8193a609b2cb127181493898");
  });

  it("gives every event a UTC time, in path order, entering in the documented window, all before the cutoff", () => {
    const start = Date.parse(JOURNEY_START);
    for (const r of syntheticJourneys(5_000, 5)) {
      expect(r.times).toHaveLength(r.path.length);
      const ms = r.times.map((t) => {
        expect(t.endsWith("Z")).toBe(true);
        return Date.parse(t);
      });
      for (let i = 1; i < ms.length; i++) expect(ms[i]).toBeGreaterThanOrEqual(ms[i - 1]);
      expect(ms[0]).toBeGreaterThanOrEqual(start);
      expect(ms[0]).toBeLessThan(start + ENTRY_DAYS * 24 * HOUR);
      expect(ms[ms.length - 1]).toBeLessThanOrEqual(Date.parse(JOURNEYS_AS_OF));
    }
  });

  it("is the same every time for the same seed, times included", () => {
    expect(syntheticJourneys(300, 9)).toEqual(syntheticJourneys(300, 9));
  });

  it("keeps every gap under the cap, and the typical gap near its documented mean", () => {
    const gaps = new Map<string, number[]>();
    for (const r of syntheticJourneys(60_000, 4)) {
      if (r.segment === "new") continue; // the planted slow segment is checked on its own below
      for (let i = 1; i < r.path.length; i++) {
        const hours = (Date.parse(r.times[i]) - Date.parse(r.times[i - 1])) / HOUR;
        expect(hours).toBeLessThanOrEqual(MAX_GAP_HOURS);
        const key = `${r.path[i - 1]} to ${r.path[i]}`;
        gaps.set(key, [...(gaps.get(key) ?? []), hours]);
      }
    }
    for (const [key, list] of gaps) {
      if (list.length < 2_000) continue;
      const sorted = [...list].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      // An exponential gap has a median of its mean times ln 2.
      const expected = GAP_MEAN_HOURS[key] * Math.LN2;
      expect(median / expected, key).toBeGreaterThan(0.9);
      expect(median / expected, key).toBeLessThan(1.1);
    }
  });

  it("plants a known timing fact: new customers take about twice as long from Cart to Purchase", () => {
    const median = (segment: string) => {
      const list: number[] = [];
      for (const r of syntheticJourneys(60_000, 4)) {
        if (r.segment !== segment) continue;
        const i = r.path.indexOf("Purchase");
        if (i > 0 && r.path[i - 1] === "Cart") list.push(Date.parse(r.times[i]) - Date.parse(r.times[i - 1]));
      }
      list.sort((a, b) => a - b);
      return list[Math.floor(list.length / 2)];
    };
    const ratio = median("new") / median("returning");
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.2);
    expect(SLOW_NEW_FACTOR).toBe(2);
  });
});
