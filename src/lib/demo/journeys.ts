import { mulberry32 } from "../stats/honesty";

/**
 * Synthetic customer journeys for the journey views. There are no people in it, only labels, so nothing here can
 * identify anyone. The generator doubles as the test fixture, plan section 5.14, because every answer is known.
 *
 * Planted facts: customers in the "new" segment who reach the cart drop off there far more often than returning
 * ones. Ads traffic also loses more people between the product page and the cart. Two detours add real paths: some
 * visitors use Search before the product page and then reach the cart more often, and some contact Support after
 * adding to the cart and then buy less often.
 */

export const JOURNEY_STEPS = ["Visit", "Product", "Cart", "Purchase"] as const;
export const CHANNELS = ["ads", "email", "organic"] as const;
export const SEGMENTS = ["new", "returning", "vip"] as const;

export type JourneyRow = {
  channel: (typeof CHANNELS)[number];
  segment: (typeof SEGMENTS)[number];
  /** One entry per step. A step that was not reached is null, and so is every step after it. */
  steps: (string | null)[];
  /** The furthest step reached. */
  reached: string;
  /** Every step in order, including the Search and Support detours. Removing the detours leaves the main steps. */
  path: string[];
  /** When each step in `path` happened, as UTC ISO times, one per step, in order. */
  times: string[];
};

/*
 * Timing assumptions, documented because every timing view in the demo inherits them. All synthetic.
 * - People enter at a uniformly random moment in the 28 days from JOURNEY_START.
 * - The gap between two events is exponential with the mean below, in hours, capped at 14 days. An exponential gap has a
 *   median of its mean times ln 2, so most people move fast and a few take much longer.
 * - Planted timing fact: new customers take twice as long to buy, from Cart or from Support to Purchase.
 * - The data cutoff, JOURNEYS_AS_OF, is after the latest possible event, so in the demo every window has closed and no
 *   customer is still in progress. Views must still handle open customers, and their tests use hand made data for it.
 * - Times come from their own seeded stream, drawn after every customer is made, so adding them changed no customer.
 */
export const JOURNEY_START = "2026-07-01T00:00:00.000Z";
export const ENTRY_DAYS = 28;
export const JOURNEYS_AS_OF = "2026-10-15T00:00:00.000Z";
export const MAX_GAP_HOURS = 14 * 24;
export const SLOW_NEW_FACTOR = 2;
export const GAP_MEAN_HOURS: Readonly<Record<string, number>> = {
  "Visit to Search": 0.1,
  "Visit to Product": 0.1,
  "Search to Product": 0.05,
  "Product to Cart": 6,
  "Cart to Support": 12,
  "Cart to Purchase": 24,
  "Support to Purchase": 24,
};
const HOUR_MS = 3_600_000;
/** Mixed into the seed so the time stream never repeats the customer stream. */
const TIME_STREAM = 0x5bd1e995;

const PICK_CHANNEL: readonly [(typeof CHANNELS)[number], number][] = [["ads", 0.3], ["email", 0.4], ["organic", 0.3]];
const PICK_SEGMENT: readonly [(typeof SEGMENTS)[number], number][] = [["new", 0.4], ["returning", 0.45], ["vip", 0.15]];

const TO_PRODUCT = { ads: 0.55, email: 0.8, organic: 0.7 } as const;
const TO_CART = { ads: 0.35, email: 0.5, organic: 0.5 } as const;
const TO_PURCHASE = { new: 0.25, returning: 0.62, vip: 0.75 } as const;
/** Chance of using Search first, by channel, and of contacting Support after the cart. */
const SEARCH_FIRST = { ads: 0.5, email: 0.2, organic: 0.35 } as const;
const SUPPORT_AFTER_CART = 0.2;
/** Search visitors reach the cart 15 points more often. Support callers buy 15 points less often. */
const SEARCH_BOOST = 0.15;
const SUPPORT_PENALTY = 0.15;

function pick<T>(table: readonly [T, number][], u: number): T {
  let acc = 0;
  for (const [value, p] of table) {
    acc += p;
    if (u < acc) return value;
  }
  return table[table.length - 1][0];
}

export function syntheticJourneys(count: number, seed: number): JourneyRow[] {
  const rng = mulberry32(seed);
  const rows: JourneyRow[] = [];
  for (let i = 0; i < count; i++) {
    const channel = pick(PICK_CHANNEL, rng());
    const segment = pick(PICK_SEGMENT, rng());
    const search = rng() < SEARCH_FIRST[channel];
    const support = rng() < SUPPORT_AFTER_CART;
    const chances = [
      1,
      TO_PRODUCT[channel],
      Math.min(1, TO_CART[channel] + (search ? SEARCH_BOOST : 0)),
      Math.max(0.05, TO_PURCHASE[segment] - (support ? SUPPORT_PENALTY : 0)),
    ];
    const steps: (string | null)[] = JOURNEY_STEPS.map(() => null);
    let alive = true;
    for (let s = 0; s < JOURNEY_STEPS.length && alive; s++) {
      if (s === 0 || rng() < chances[s]) steps[s] = JOURNEY_STEPS[s];
      else alive = false;
    }
    const reached = steps.filter((x): x is string => x !== null).at(-1) as string;
    const path: string[] = [];
    steps.forEach((step, s) => {
      if (step === null) return;
      if (s === 1 && search) path.push("Search");
      path.push(step);
      if (s === 2 && support) path.push("Support");
    });
    rows.push({ channel, segment, steps, reached, path, times: [] });
  }

  const timeRng = mulberry32((seed ^ TIME_STREAM) >>> 0);
  const start = Date.parse(JOURNEY_START);
  for (const row of rows) {
    let t = start + Math.floor(timeRng() * ENTRY_DAYS * 24 * HOUR_MS);
    row.times.push(new Date(t).toISOString());
    for (let i = 1; i < row.path.length; i++) {
      const key = `${row.path[i - 1]} to ${row.path[i]}`;
      const slow = row.segment === "new" && row.path[i] === "Purchase" ? SLOW_NEW_FACTOR : 1;
      const mean = GAP_MEAN_HOURS[key] * slow;
      const hours = Math.min(MAX_GAP_HOURS, -mean * Math.log(1 - timeRng()));
      t += Math.round(hours * HOUR_MS);
      row.times.push(new Date(t).toISOString());
    }
  }
  return rows;
}
