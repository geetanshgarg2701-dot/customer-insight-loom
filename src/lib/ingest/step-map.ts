/**
 * Mapping a sender's own event names onto the journey's steps. A shop or email tool sends names like "add_to_cart" or
 * "order_paid". The journey knows six steps. A person decides, name by name, which step each one is, or that it should be
 * ignored. The app may suggest a step from the words in a name, but a suggestion is never applied on its own.
 *
 * Names come from outside, so only a plain form is accepted, 1 to 64 letters, digits, dots, dashes, underscores or
 * colons. A name in any other form is rejected, and is never listed for mapping, so nothing a sender writes can end up
 * shown as markup or used as an object key.
 */

export const JOURNEY_TARGETS = ["Visit", "Search", "Product", "Cart", "Support", "Purchase"] as const;
export type JourneyTarget = (typeof JOURNEY_TARGETS)[number];

/** Sender name to journey step, or null to ignore events with that name. */
export type StepMap = Readonly<Record<string, JourneyTarget | null>>;

export const SENDER_NAME = /^[A-Za-z0-9._:-]{1,64}$/;
export const MAX_MAPPED = 100;
/** How many distinct unmapped names are listed for a person to map. More are counted, not listed. */
export const MAX_UNMAPPED_NAMES = 50;

/** Every problem with a map, as plain sentences. Empty means it can be used. */
export function checkStepMap(map: StepMap): string[] {
  const names = Object.keys(map);
  if (names.length > MAX_MAPPED) return [`A sender may map at most ${MAX_MAPPED} step names.`];
  const problems: string[] = [];
  for (const name of names) {
    if (!SENDER_NAME.test(name)) {
      problems.push(`"${name}" is not a usable step name: use 1 to 64 letters, digits, dots, dashes, underscores or colons.`);
      continue;
    }
    const target = map[name];
    if (target !== null && !(JOURNEY_TARGETS as readonly string[]).includes(target)) {
      problems.push(`"${name}" maps to "${String(target)}", which is not a journey step.`);
    }
  }
  return problems;
}

export type Resolved = { kind: "mapped"; step: JourneyTarget } | { kind: "ignored" } | { kind: "unmapped" } | { kind: "bad" };

/** What a sender's step name means under a map. Only the map's own keys count, never inherited ones such as toString. */
export function resolveStep(map: StepMap, name: unknown): Resolved {
  if (typeof name !== "string" || !SENDER_NAME.test(name)) return { kind: "bad" };
  if (!Object.prototype.hasOwnProperty.call(map, name)) return { kind: "unmapped" };
  const target = map[name];
  return target === null ? { kind: "ignored" } : { kind: "mapped", step: target };
}

// Most specific first: "pdp_view" is a product, and "page_view" a visit.
const CLUES: [RegExp, JourneyTarget][] = [
  [/order|paid|purchase|checkout[_.:-]?complete/i, "Purchase"],
  [/support|help|ticket|chat|contact/i, "Support"],
  [/cart|basket|bag/i, "Cart"],
  [/search|query/i, "Search"],
  [/product|pdp|item|sku/i, "Product"],
  [/page[_.:-]?view|visit|landing|session[_.:-]?start|home/i, "Visit"],
];

/** A step the name hints at, for a person to confirm, or null when it gives no clue. Never applied automatically. */
export function suggestStep(name: string): JourneyTarget | null {
  for (const [pattern, step] of CLUES) if (pattern.test(name)) return step;
  return null;
}
