/**
 * Synthetic customer comments for the insights module. Every comment belongs to a real row of the synthetic journeys, so
 * what a customer says can be read next to what the customer did. All of it is invented.
 *
 * Planted facts, which the evidence chain must be able to find and which no screen may call causal:
 * - customers who left at the Cart mention shipping cost far more often, and new customers more often than returning ones
 * - customers who came through ads mention pricing more often
 * - customers whose path includes Support mention slow support far more often
 * - customers who bought are the only ones who mention slow delivery
 *
 * Fake personal details are planted on purpose so the redaction step has something to catch, and each comment records
 * how many of each kind it holds. Emails use the reserved .invalid domain, phones use the reserved 555-01xx range, and
 * the card is a published test number, so none of them can reach a real person. Invented names are planted too. The
 * redaction layer does not remove names, and the scorecard says so.
 */
import { mulberry32 } from "../stats/honesty";
import type { JourneyRow } from "../demo/journeys";

export const PAINS = [
  "shipping_cost",
  "pricing",
  "slow_delivery",
  "support_slow",
  "site_bugs",
  "product_info",
  "no_issue",
] as const;
export type Pain = (typeof PAINS)[number];

export const PAIN_LABELS: Readonly<Record<Pain, string>> = {
  shipping_cost: "Shipping costs too much",
  pricing: "Price feels too high",
  slow_delivery: "Delivery was slow",
  support_slow: "Support was slow to answer",
  site_bugs: "The site had a problem",
  product_info: "Not enough product information",
  no_issue: "No complaint",
};

/** A published payment test card number. It passes the Luhn check and belongs to no one. */
export const TEST_CARD = "4242 4242 4242 4242";
export const CONSENT_RATE = 0.85;

export type PlantedCounts = { email: number; phone: number; card: number; address: number; name: number };

export type SyntheticComment = {
  /** Index of the customer in the journeys this comment was made from. */
  customer: number;
  segment: JourneyRow["segment"];
  channel: JourneyRow["channel"];
  reached: string;
  pain: Pain;
  severity: 1 | 2 | 3;
  consent: boolean;
  text: string;
  planted: PlantedCounts;
};

const SENTENCES: Readonly<Record<Pain, readonly string[]>> = {
  shipping_cost: [
    "The shipping fee showed up at the very end and it was more than I expected.",
    "I almost bought, then saw what delivery would cost and closed the page.",
    "Shipping costs as much as the item itself, which is hard to justify.",
  ],
  pricing: [
    "Honestly the price is higher than similar shops I looked at.",
    "I liked the product but could not justify paying this much.",
    "A small discount would have made me buy today.",
  ],
  slow_delivery: [
    "My order took almost two weeks to arrive, much longer than promised.",
    "The package was late and the tracking page never updated.",
    "Delivery was slow, though the item itself was fine.",
  ],
  support_slow: [
    "I wrote to support and waited three days for a reply.",
    "Nobody answered my question about my order for a long time.",
    "The support team was polite but very slow to respond.",
  ],
  site_bugs: [
    "The page froze when I tried to change the size.",
    "My cart emptied itself once and I had to start again.",
    "The checkout button did nothing the first time I pressed it.",
  ],
  product_info: [
    "I could not tell from the page what size to order.",
    "The description left out the material, and I wanted to know.",
    "More photos of the product would have helped me decide.",
  ],
  no_issue: [
    "Everything went smoothly and I would order again.",
    "Good experience overall, nothing to add.",
    "The whole thing was quick and easy.",
  ],
};

const FIRST = ["Alex", "Jordan", "Sam", "Taylor", "Morgan", "Riley", "Casey", "Jamie", "Avery", "Quinn", "Drew", "Robin"];
const LAST = ["Rivera", "Nguyen", "Okafor", "Lindqvist", "Moreau", "Haddad", "Castillo", "Brennan", "Sato", "Kowalski"];
const STREETS = ["Maple", "Cedar", "Willow", "Harbor", "Juniper", "Lantern", "Orchard"];
const STREET_KINDS = ["Street", "Avenue", "Road"];

/** Share of comments that plant each kind of detail. Fixed, so the redaction scorecard has a known total to compare with. */
const PLANT_RATE = { email: 0.15, phone: 0.08, card: 0.03, address: 0.04, name: 0.12 } as const;

function weights(j: JourneyRow): Record<Pain, number> {
  const w: Record<Pain, number> = {
    shipping_cost: 0.06,
    pricing: 0.12,
    slow_delivery: 0,
    support_slow: 0.02,
    site_bugs: 0.08,
    product_info: 0.12,
    no_issue: 0.2,
  };
  if (j.reached === "Cart") w.shipping_cost += 0.35;
  if (j.segment === "new") w.shipping_cost *= 1.5;
  if (j.channel === "ads") w.pricing += 0.1;
  if (j.path.includes("Support")) w.support_slow += 0.5;
  if (j.reached === "Purchase") w.slow_delivery += 0.25;
  return w;
}

function draw(table: Record<Pain, number>, u: number): Pain {
  const total = PAINS.reduce((n, k) => n + table[k], 0);
  let acc = 0;
  for (const k of PAINS) {
    acc += table[k] / total;
    if (u < acc) return k;
  }
  return PAINS[PAINS.length - 1];
}

function item<T>(list: readonly T[], u: number): T {
  return list[Math.min(list.length - 1, Math.floor(u * list.length))];
}

/** Makes `count` comments, each from a different customer of `journeys`, in a fixed order for a given seed. */
export function syntheticComments(journeys: readonly JourneyRow[], count: number, seed: number): SyntheticComment[] {
  if (!Number.isInteger(count) || count < 1 || count > journeys.length) {
    throw new RangeError(`Ask for 1 to ${journeys.length} comments, one per customer.`);
  }
  const rng = mulberry32(seed);
  // A partial shuffle picks distinct customers without scanning them all.
  const index = Array.from({ length: journeys.length }, (_, i) => i);
  for (let i = 0; i < count; i++) {
    const k = i + Math.floor(rng() * (index.length - i));
    [index[i], index[k]] = [index[k], index[i]];
  }
  const out: SyntheticComment[] = [];
  for (let n = 0; n < count; n++) {
    const customer = index[n];
    const j = journeys[customer];
    const pain = draw(weights(j), rng());
    const severity = pain === "no_issue" ? 1 : ((1 + Math.floor(rng() * 3)) as 1 | 2 | 3);
    const consent = rng() < CONSENT_RATE;
    const first = item(FIRST, rng());
    const last = item(LAST, rng());
    const planted: PlantedCounts = { email: 0, phone: 0, card: 0, address: 0, name: 0 };
    const parts = [item(SENTENCES[pain], rng())];
    if (severity === 3) parts.push("This was a real problem for me.");
    if (rng() < PLANT_RATE.email) {
      planted.email = 1;
      parts.push(`You can reach me at ${first.toLowerCase()}.${last.toLowerCase()}${Math.floor(rng() * 90) + 10}@example.invalid.`);
    }
    if (rng() < PLANT_RATE.phone) {
      planted.phone = 1;
      parts.push(`Call me on 501-555-01${String(Math.floor(rng() * 100)).padStart(2, "0")}.`);
    }
    if (rng() < PLANT_RATE.card) {
      planted.card = 1;
      parts.push(`I paid with ${TEST_CARD}.`);
    }
    if (rng() < PLANT_RATE.address) {
      planted.address = 1;
      parts.push(`Send it to ${Math.floor(rng() * 899) + 100} ${item(STREETS, rng())} ${item(STREET_KINDS, rng())}.`);
    }
    if (rng() < PLANT_RATE.name) {
      planted.name = 1;
      parts.push(`Thanks, ${first} ${last}.`);
    }
    out.push({ customer, segment: j.segment, channel: j.channel, reached: j.reached, pain, severity, consent, text: parts.join(" "), planted });
  }
  return out;
}
