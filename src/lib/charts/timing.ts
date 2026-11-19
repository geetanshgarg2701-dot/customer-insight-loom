import { JOURNEY_STEPS } from "../demo/journeys";
import { toPlainRow } from "../duckdb/normalize";
import type { SqlEngine } from "../intake/types";
import { whereClause, type Selection } from "./crossfilter";

/**
 * Time spent between steps, computed in SQL. For each main step, the hours from reaching it to reaching the next, as a
 * median with quartiles and the 10th and 90th percentiles, so the spread shows and not only an average. Time from Cart to
 * Purchase includes any Support detour in between.
 *
 * People who reached a step and not the next are split two ways, never counted as non-movers in one lump: still
 * waiting, if their conversion window, counted from entry into the journey, has not closed at the data cutoff, and
 * dropped, if it has.
 */

const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;
const HOUR_MS = 3_600_000;

export type StepTiming = {
  step: string;
  /** People who reached both this step and the next. Their times are the ones measured. */
  moved: number;
  /** Null when nobody moved, so there is nothing to measure. */
  medianHours: number | null;
  p10Hours: number | null;
  p25Hours: number | null;
  p75Hours: number | null;
  p90Hours: number | null;
  /** Reached this step, not the next, and the window counted from entry is still open at the cutoff. */
  waiting: number;
  /** Reached this step, not the next, and the window has closed. */
  dropped: number;
};

export type Timing = { asOf: string; windowHours: number; steps: StepTiming[] };

export async function timeInStep(
  engine: SqlEngine,
  table: string,
  selection: Selection,
  options: { asOf: string; windowHours: number },
): Promise<Timing> {
  if (!TABLE_NAME.test(table)) throw new RangeError("Table name must be lower case letters, digits and underscores.");
  const asOfMs = Date.parse(options.asOf);
  if (!Number.isFinite(asOfMs)) throw new RangeError("The data cutoff is not a time.");
  if (!Number.isFinite(options.windowHours) || options.windowHours <= 0) {
    throw new RangeError("The window must be a number of hours above 0.");
  }
  const windowMs = options.windowHours * HOUR_MS;
  const where = whereClause(selection);
  const joiner = where.sql ? `${where.sql} AND` : "WHERE";

  const steps: StepTiming[] = [];
  for (let i = 1; i < JOURNEY_STEPS.length; i++) {
    const from = `t${i}`;
    const to = `t${i + 1}`;
    const hours = `(${to} - ${from}) / ${HOUR_MS}.0`;
    // The window is counted from entry into the journey, t1. It is open while the cutoff is at or before its end.
    const [row] = (
      await engine.query(
        `SELECT count(${to}) AS moved, ` +
          `quantile_cont(${hours}, 0.5) AS p50, quantile_cont(${hours}, 0.1) AS p10, quantile_cont(${hours}, 0.25) AS p25, ` +
          `quantile_cont(${hours}, 0.75) AS p75, quantile_cont(${hours}, 0.9) AS p90, ` +
          `count(*) FILTER (WHERE ${to} IS NULL AND ? <= t1 + ?) AS waiting, ` +
          `count(*) FILTER (WHERE ${to} IS NULL AND ? > t1 + ?) AS dropped ` +
          `FROM ${table} ${joiner} ${from} IS NOT NULL`,
        [asOfMs, windowMs, asOfMs, windowMs, ...where.params],
      )
    ).map(toPlainRow);
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    steps.push({
      step: `${JOURNEY_STEPS[i - 1]} to ${JOURNEY_STEPS[i]}`,
      moved: Number(row.moved),
      medianHours: num(row.p50),
      p10Hours: num(row.p10),
      p25Hours: num(row.p25),
      p75Hours: num(row.p75),
      p90Hours: num(row.p90),
      waiting: Number(row.waiting),
      dropped: Number(row.dropped),
    });
  }
  return { asOf: options.asOf, windowHours: options.windowHours, steps };
}

/** A duration in hours, as minutes under an hour, hours under two days, and days after that. */
export function formatDuration(hours: number): string {
  if (!Number.isFinite(hours)) return "not available";
  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  if (hours < 48) return `${hours.toFixed(1)} hours`;
  return `${(hours / 24).toFixed(1)} days`;
}

/** One step's spread in plain words, because a box plot alone is easy to misread. */
export function timingSentence(s: StepTiming, windowHours: number): string {
  const [from, to] = s.step.split(" to ");
  if (s.moved === 0 || s.medianHours === null) {
    return `Nobody went from ${from} to ${to} in this selection, so there is no time to show.`;
  }
  let text =
    `Of ${s.moved.toLocaleString("en-US")} ${s.moved === 1 ? "person" : "people"} who went from ${from} to ${to}, ` +
    `half took less than ${formatDuration(s.medianHours)}. The middle half took ${formatDuration(s.p25Hours!)} to ` +
    `${formatDuration(s.p75Hours!)}, and 1 in 10 took longer than ${formatDuration(s.p90Hours!)}.`;
  if (s.waiting > 0) {
    const days = Math.round(windowHours / 24);
    text +=
      s.waiting === 1
        ? ` 1 person is still inside the ${days} day window and is shown apart, not as dropped.`
        : ` ${s.waiting.toLocaleString("en-US")} people are still inside the ${days} day window and are shown apart, not as dropped.`;
  }
  return text;
}
