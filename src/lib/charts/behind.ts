import { JOURNEY_STEPS } from "../demo/journeys";
import { toPlainRow } from "../duckdb/normalize";
import type { SqlEngine } from "../intake/types";
import { wilsonInterval } from "../stats/readout";
import { MIN_GROUP } from "./compare";
import { whereClause, type Selection } from "./crossfilter";

/**
 * Who is behind one step: the people who reached it, by segment and channel, with how many went on to the next step
 * and how many left there. Aggregates only, never individual people, because the public demo has no accounts and the
 * plan shows individual paths only to authorized users.
 *
 * Groups under the minimum size are merged into one row. If the merged row is itself under the minimum, its numbers
 * are hidden, so no small group can be read off the screen. The step totals always include everyone.
 */

const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;
const ALPHA = 0.05;

export type BehindGroup = {
  label: string;
  segment: string | null;
  channel: string | null;
  /** Null when the group is hidden. */
  reached: number | null;
  /** Null after the last step, or when hidden. */
  movedOn: number | null;
  left: number | null;
  rate: number | null;
  low: number | null;
  high: number | null;
  merged: boolean;
  /** How many groups a merged row holds. 0 for an ordinary group. */
  mergedGroups: number;
  hidden: boolean;
};

export type BehindStep = {
  step: string;
  /** The step after this one, or null after the last step. */
  next: string | null;
  reached: number;
  movedOn: number | null;
  left: number | null;
  groups: BehindGroup[];
  minGroup: number;
  /** For a detour: people whose next event was not the designed one. 0 for a main step, where every path is designed. */
  elsewhere: number;
  detour: boolean;
};

/** The two detours in the designed journey, and the main step each one leads back to. */
export const DETOURS = [
  { step: "Search", next: "Product" },
  { step: "Support", next: "Purchase" },
] as const;
export type DetourStep = (typeof DETOURS)[number]["step"];
const PATH_SEPARATOR = " > ";

type Counted = { segment: string; channel: string; reached: number; movedOn: number | null; left: number | null };

/** The shared group rules: groups under the minimum are merged, and a merged row still under it has its numbers hidden. */
function groupsOf(all: readonly Counted[]): BehindGroup[] {
  const groups: BehindGroup[] = all
    .filter((g) => g.reached >= MIN_GROUP)
    .map((g) => ({
      label: `${g.segment}, ${g.channel}`,
      segment: g.segment,
      channel: g.channel,
      reached: g.reached,
      movedOn: g.movedOn,
      left: g.left,
      ...rateOf(g.reached, g.movedOn),
      merged: false,
      mergedGroups: 0,
      hidden: false,
    }));
  const small = all.filter((g) => g.reached < MIN_GROUP);
  if (small.length > 0) {
    const mReached = small.reduce((n, g) => n + g.reached, 0);
    const none = small[0].movedOn === null;
    const mMoved = none ? null : small.reduce((n, g) => n + (g.movedOn ?? 0), 0);
    const mLeft = none ? null : small.reduce((n, g) => n + (g.left ?? 0), 0);
    const hidden = mReached < MIN_GROUP;
    const count = `${small.length} smaller ${small.length === 1 ? "group" : "groups"}, merged`;
    groups.push({
      label: hidden ? `${count}, under ${MIN_GROUP} people in total, so their numbers are hidden` : count,
      segment: null,
      channel: null,
      reached: hidden ? null : mReached,
      movedOn: hidden ? null : mMoved,
      left: hidden ? null : mLeft,
      ...(hidden ? { rate: null, low: null, high: null } : rateOf(mReached, mMoved)),
      merged: true,
      mergedGroups: small.length,
      hidden,
    });
  }
  return groups;
}

function rateOf(reached: number, movedOn: number | null) {
  if (movedOn === null || reached === 0) return { rate: null, low: null, high: null };
  const w = wilsonInterval(movedOn, reached, ALPHA);
  return { rate: movedOn / reached, low: w.low, high: w.high };
}

export async function behindStep(
  engine: SqlEngine,
  table: string,
  selection: Selection,
  stepIndex: number,
): Promise<BehindStep> {
  if (!TABLE_NAME.test(table)) throw new RangeError("Table name must be lower case letters, digits and underscores.");
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= JOURNEY_STEPS.length) {
    throw new RangeError("That is not a step in this journey.");
  }
  const last = stepIndex === JOURNEY_STEPS.length - 1;
  const here = `s${stepIndex + 1}`;
  const nextColumn = `s${stepIndex + 2}`;
  const where = whereClause(selection);
  const joiner = where.sql ? `${where.sql} AND` : "WHERE";
  const moved = last ? "0" : `count(${nextColumn})`;
  const rows = (
    await engine.query(
      `SELECT segment, channel, count(*) AS reached, ${moved} AS moved FROM ${table} ${joiner} ${here} IS NOT NULL ` +
        `GROUP BY segment, channel ORDER BY reached DESC, segment, channel`,
      where.params,
    )
  ).map(toPlainRow);

  const all: Counted[] = rows.map((r) => {
    const reachedHere = Number(r.reached);
    const moved = last ? null : Number(r.moved);
    return { segment: String(r.segment), channel: String(r.channel), reached: reachedHere, movedOn: moved, left: moved === null ? null : reachedHere - moved };
  });
  const reached = all.reduce((n, g) => n + g.reached, 0);
  const movedOn = last ? null : all.reduce((n, g) => n + (g.movedOn ?? 0), 0);
  const groups = groupsOf(all);

  return {
    step: JOURNEY_STEPS[stepIndex],
    next: last ? null : JOURNEY_STEPS[stepIndex + 1],
    reached,
    movedOn,
    left: movedOn === null ? null : reached - movedOn,
    groups,
    minGroup: MIN_GROUP,
    elsewhere: 0,
    detour: false,
  };
}

/**
 * Who used a detour, Search or Support, read from the full path. Went on means the event right after the detour was the
 * designed next step. Left means the detour was their last event. Anything else, such as going back to Product after
 * Support, is counted apart as elsewhere, so the three add up to everyone. The first visit to the detour is the one read.
 */
export async function behindDetour(engine: SqlEngine, table: string, selection: Selection, step: DetourStep): Promise<BehindStep> {
  if (!TABLE_NAME.test(table)) throw new RangeError("Table name must be lower case letters, digits and underscores.");
  const detour = DETOURS.find((d) => d.step === step);
  if (!detour) throw new RangeError("That is not a detour in this journey.");
  const where = whereClause(selection);
  const rows = (
    await engine.query(
      `WITH p AS (SELECT segment, channel, string_split(path, ?) AS ps FROM ${table} ${where.sql}), ` +
        `d AS (SELECT segment, channel, ps, list_position(ps, ?) AS i FROM p WHERE list_contains(ps, ?)) ` +
        `SELECT segment, channel, count(*) AS reached, count(*) FILTER (WHERE ps[i + 1] = ?) AS moved, ` +
        `count(*) FILTER (WHERE i = len(ps)) AS ended FROM d GROUP BY segment, channel ORDER BY reached DESC, segment, channel`,
      [PATH_SEPARATOR, ...where.params, detour.step, detour.step, detour.next],
    )
  ).map(toPlainRow);
  const all: Counted[] = rows.map((r) => ({
    segment: String(r.segment),
    channel: String(r.channel),
    reached: Number(r.reached),
    movedOn: Number(r.moved),
    left: Number(r.ended),
  }));
  const reached = all.reduce((n, g) => n + g.reached, 0);
  const movedOn = all.reduce((n, g) => n + (g.movedOn ?? 0), 0);
  const left = all.reduce((n, g) => n + (g.left ?? 0), 0);
  return {
    step: detour.step,
    next: detour.next,
    reached,
    movedOn,
    left,
    groups: groupsOf(all),
    minGroup: MIN_GROUP,
    elsewhere: reached - movedOn - left,
    detour: true,
  };
}
