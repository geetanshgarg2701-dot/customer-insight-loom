import type { PathCount } from "./anchored";

/**
 * The number tiles at the top of the journeys screen, worked out from the same path counts as the charts, so a tile can
 * never disagree with them. Shares are of the customers in the current selection.
 */
export type JourneyTiles = {
  customers: number;
  /** Reached Purchase, as a share. Null when nobody is selected. */
  bought: number | null;
  /** Used Search or Support at least once, as a share. */
  detoured: number | null;
  /** The step most people ended on, and how many. */
  topExit: { step: string; count: number } | null;
};

const DETOUR_STEPS = new Set(["Search", "Support"]);

export function journeyTiles(paths: readonly PathCount[]): JourneyTiles {
  let customers = 0;
  let bought = 0;
  let detoured = 0;
  const ends = new Map<string, number>();
  for (const { path, count } of paths) {
    customers += count;
    if (path.includes("Purchase")) bought += count;
    if (path.some((s) => DETOUR_STEPS.has(s))) detoured += count;
    const last = path[path.length - 1];
    if (last !== undefined && last !== "Purchase") ends.set(last, (ends.get(last) ?? 0) + count);
  }
  let topExit: JourneyTiles["topExit"] = null;
  for (const [step, count] of ends) if (!topExit || count > topExit.count || (count === topExit.count && step < topExit.step)) topExit = { step, count };
  return {
    customers,
    bought: customers === 0 ? null : bought / customers,
    detoured: customers === 0 ? null : detoured / customers,
    topExit,
  };
}
