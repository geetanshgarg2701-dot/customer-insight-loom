import { mulberry32 } from "../stats/honesty";

/**
 * Synthetic customer journeys for the journey views. There are no people in it, only labels, so nothing here can
 * identify anyone. The generator doubles as the test fixture, plan section 5.14, because every answer is known.
 *
 * Planted fact: customers in the "new" segment who reach the cart drop off there far more often than returning
 * ones. Ads traffic also loses more people between the product page and the cart.
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
};

const PICK_CHANNEL: readonly [(typeof CHANNELS)[number], number][] = [["ads", 0.3], ["email", 0.4], ["organic", 0.3]];
const PICK_SEGMENT: readonly [(typeof SEGMENTS)[number], number][] = [["new", 0.4], ["returning", 0.45], ["vip", 0.15]];

const TO_PRODUCT = { ads: 0.55, email: 0.8, organic: 0.7 } as const;
const TO_CART = { ads: 0.35, email: 0.5, organic: 0.5 } as const;
const TO_PURCHASE = { new: 0.25, returning: 0.62, vip: 0.75 } as const;

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
    const chances = [1, TO_PRODUCT[channel], TO_CART[channel], TO_PURCHASE[segment]];
    const steps: (string | null)[] = JOURNEY_STEPS.map(() => null);
    let alive = true;
    for (let s = 0; s < JOURNEY_STEPS.length && alive; s++) {
      if (s === 0 || rng() < chances[s]) steps[s] = JOURNEY_STEPS[s];
      else alive = false;
    }
    const reached = steps.filter((x): x is string => x !== null).at(-1) as string;
    rows.push({ channel, segment, steps, reached });
  }
  return rows;
}
