/**
 * Designed rule nodes for the journey canvas, plan section 3: a wait after a step, and exit conditions. Both are rules
 * a marketer designs, and the numbers on them are counted from the data, never typed in.
 *
 * A wait after a step says how long a person is expected to sit before the next step. For everyone who reached the
 * step it counts who moved on within the wait, who moved on later, who is still inside the wait at the data cutoff, and
 * who sat through the whole wait and has not moved. The four always add up to everyone who reached the step.
 *
 * Exit conditions say when a person leaves the journey: when they reach the goal, or when they have had no event for a
 * set number of days. Everyone is in exactly one of three groups at the cutoff: reached the goal, inactive past the
 * threshold, or still active. This is the plan's Dropped definition, with its threshold shown beside the number.
 *
 * Times are UTC. A move exactly at the wait counts as within it. A last event exactly the threshold before the cutoff
 * counts as inactive.
 */
import { JOURNEY_STEPS } from "../demo/journeys";
import { toPlainRow } from "../duckdb/normalize";
import type { SqlEngine } from "../intake/types";
import { whereClause, type Selection } from "./crossfilter";

const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;
const DAY_MS = 86_400_000;
const TIME_COLUMNS = ["t1", "t2", "t3", "t4"] as const;

/** Waits and inactivity rules the screen offers, in days. A wait of 7 days or more is the same as the plan's one week window. */
export const WAIT_CHOICES = [1, 3, 7] as const;
export const INACTIVE_CHOICES = [14, 30, 90] as const;

function checkCommon(table: string, asOf: string, days: number, label: string): number {
  if (!TABLE_NAME.test(table)) throw new RangeError("Table name must be lower case letters, digits and underscores.");
  const asOfMs = Date.parse(asOf);
  if (!Number.isFinite(asOfMs)) throw new RangeError("The data cutoff is not a time.");
  if (!Number.isFinite(days) || days <= 0) throw new RangeError(`${label} must be a number of days above 0.`);
  return asOfMs;
}

export type WaitResult = {
  step: string;
  next: string;
  days: number;
  reached: number;
  /** Moved on to the next step within the wait. */
  within: number;
  /** Moved on, but later than the wait. */
  later: number;
  /** Has not moved on, and the wait is not over at the cutoff. */
  stillWaiting: number;
  /** Has not moved on, and the wait was over at the cutoff. */
  outlasted: number;
};

/** The wait after one main step, for everyone who reached it. The last step has nothing to wait for. */
export async function waitAfter(
  engine: SqlEngine,
  table: string,
  selection: Selection,
  options: { stepIndex: number; days: number; asOf: string },
): Promise<WaitResult> {
  const asOfMs = checkCommon(table, options.asOf, options.days, "The wait");
  const k = options.stepIndex;
  if (!Number.isInteger(k) || k < 0 || k >= JOURNEY_STEPS.length - 1) {
    throw new RangeError("A wait needs a step with a next step after it.");
  }
  const from = TIME_COLUMNS[k];
  const to = TIME_COLUMNS[k + 1];
  const waitMs = options.days * DAY_MS;
  const where = whereClause(selection);
  const [row] = (
    await engine.query(
      `SELECT count(*) AS reached, ` +
        `count(*) FILTER (WHERE ${to} IS NOT NULL AND ${to} - ${from} <= ?) AS within, ` +
        `count(*) FILTER (WHERE ${to} IS NOT NULL AND ${to} - ${from} > ?) AS later, ` +
        `count(*) FILTER (WHERE ${to} IS NULL AND ? < ${from} + ?) AS still_waiting, ` +
        `count(*) FILTER (WHERE ${to} IS NULL AND ? >= ${from} + ?) AS outlasted ` +
        `FROM ${table} ${where.sql ? `${where.sql} AND` : "WHERE"} ${from} IS NOT NULL`,
      [waitMs, waitMs, asOfMs, waitMs, asOfMs, waitMs, ...where.params],
    )
  ).map(toPlainRow);
  return {
    step: JOURNEY_STEPS[k],
    next: JOURNEY_STEPS[k + 1],
    days: options.days,
    reached: Number(row.reached),
    within: Number(row.within),
    later: Number(row.later),
    stillWaiting: Number(row.still_waiting),
    outlasted: Number(row.outlasted),
  };
}

export type ExitResult = {
  total: number;
  /** Reached the last step. */
  goal: number;
  /** Did not reach the goal, and the last event was at least the threshold before the cutoff. */
  inactive: number;
  /** Did not reach the goal, and the last event is more recent than the threshold. */
  active: number;
  inactiveDays: number;
};

export async function exitRules(
  engine: SqlEngine,
  table: string,
  selection: Selection,
  options: { inactiveDays: number; asOf: string },
): Promise<ExitResult> {
  const asOfMs = checkCommon(table, options.asOf, options.inactiveDays, "The inactivity rule");
  const gap = options.inactiveDays * DAY_MS;
  const where = whereClause(selection);
  const [row] = (
    await engine.query(
      `SELECT count(*) AS total, count(t4) AS goal, ` +
        `count(*) FILTER (WHERE t4 IS NULL AND tl + ? <= ?) AS inactive, ` +
        `count(*) FILTER (WHERE t4 IS NULL AND tl + ? > ?) AS active ` +
        `FROM ${table} ${where.sql}`,
      [gap, asOfMs, gap, asOfMs, ...where.params],
    )
  ).map(toPlainRow);
  return {
    total: Number(row.total),
    goal: Number(row.goal),
    inactive: Number(row.inactive),
    active: Number(row.active),
    inactiveDays: options.inactiveDays,
  };
}
