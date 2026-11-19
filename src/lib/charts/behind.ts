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
};

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

  const all = rows.map((r) => ({
    segment: String(r.segment),
    channel: String(r.channel),
    reached: Number(r.reached),
    movedOn: last ? null : Number(r.moved),
  }));
  const reached = all.reduce((n, g) => n + g.reached, 0);
  const movedOn = last ? null : all.reduce((n, g) => n + (g.movedOn ?? 0), 0);

  const groups: BehindGroup[] = all
    .filter((g) => g.reached >= MIN_GROUP)
    .map((g) => ({
      label: `${g.segment}, ${g.channel}`,
      segment: g.segment,
      channel: g.channel,
      reached: g.reached,
      movedOn: g.movedOn,
      left: g.movedOn === null ? null : g.reached - g.movedOn,
      ...rateOf(g.reached, g.movedOn),
      merged: false,
      mergedGroups: 0,
      hidden: false,
    }));

  const small = all.filter((g) => g.reached < MIN_GROUP);
  if (small.length > 0) {
    const mReached = small.reduce((n, g) => n + g.reached, 0);
    const mMoved = last ? null : small.reduce((n, g) => n + (g.movedOn ?? 0), 0);
    const hidden = mReached < MIN_GROUP;
    const count = `${small.length} smaller ${small.length === 1 ? "group" : "groups"}, merged`;
    groups.push({
      label: hidden ? `${count}, under ${MIN_GROUP} people in total, so their numbers are hidden` : count,
      segment: null,
      channel: null,
      reached: hidden ? null : mReached,
      movedOn: hidden ? null : mMoved,
      left: hidden || mMoved === null ? null : mReached - mMoved,
      ...(hidden ? { rate: null, low: null, high: null } : rateOf(mReached, mMoved)),
      merged: true,
      mergedGroups: small.length,
      hidden,
    });
  }

  return {
    step: JOURNEY_STEPS[stepIndex],
    next: last ? null : JOURNEY_STEPS[stepIndex + 1],
    reached,
    movedOn,
    left: movedOn === null ? null : reached - movedOn,
    groups,
    minGroup: MIN_GROUP,
  };
}
