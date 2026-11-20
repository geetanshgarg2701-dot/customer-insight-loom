/**
 * The journey over time, plan section 3: for every day from the first event to the last, how many people reached each
 * main step that day and by the end of it. The scrubber reads the funnel as of any day, and ledger launches are marked
 * on the same days.
 *
 * Days are UTC calendar days. The range comes from the whole table, not the filtered rows, so the axis stays put when a
 * filter changes. A before and after comparison around a marker is a count of what happened on those days. It is not the
 * test's measured lift, which only the ledger readout against its holdout gives.
 */
import { JOURNEY_STEPS } from "../demo/journeys";
import { toPlainRow } from "../duckdb/normalize";
import type { SqlEngine } from "../intake/types";
import { whereClause, type Selection } from "./crossfilter";

const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;
const DAY_MS = 86_400_000;
const TIME_COLUMNS = ["t1", "t2", "t3", "t4"] as const;

export type StepsOverTime = {
  /** Every UTC day from the first event to the last, as YYYY-MM-DD. */
  days: string[];
  /** daily[step][day]: people who reached that step on that day. */
  daily: number[][];
  /** cumulative[step][day]: people who had reached that step by the end of that day. */
  cumulative: number[][];
};

const isoDay = (dayNumber: number) => new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);

export async function stepsOverTime(engine: SqlEngine, table: string, selection: Selection): Promise<StepsOverTime> {
  if (!TABLE_NAME.test(table)) throw new RangeError("Table name must be lower case letters, digits and underscores.");
  const [range] = (
    await engine.query(
      `SELECT CAST(floor(min(t1) / ${DAY_MS}) AS BIGINT) AS first, ` +
        `CAST(floor(max(greatest(t1, coalesce(t2, t1), coalesce(t3, t1), coalesce(t4, t1))) / ${DAY_MS}) AS BIGINT) AS last FROM ${table}`,
      [],
    )
  ).map(toPlainRow);
  if (range.first === null) return { days: [], daily: JOURNEY_STEPS.map(() => []), cumulative: JOURNEY_STEPS.map(() => []) };
  const first = Number(range.first);
  const count = Number(range.last) - first + 1;
  const days = Array.from({ length: count }, (_, i) => isoDay(first + i));

  const where = whereClause(selection);
  const daily: number[][] = [];
  for (const column of TIME_COLUMNS) {
    const rows = (
      await engine.query(
        `SELECT CAST(floor(${column} / ${DAY_MS}) AS BIGINT) AS day, count(*) AS n FROM ${table} ` +
          `${where.sql ? `${where.sql} AND` : "WHERE"} ${column} IS NOT NULL GROUP BY 1`,
        where.params,
      )
    ).map(toPlainRow);
    const counts = new Array<number>(count).fill(0);
    for (const r of rows) counts[Number(r.day) - first] += Number(r.n);
    daily.push(counts);
  }
  const cumulative = daily.map((d) => {
    let sum = 0;
    return d.map((x) => (sum += x));
  });
  return { days, daily, cumulative };
}

export type MarkerEntry = { id: string; title: string; launchedAt: string | null };
export type Marker = { id: string; title: string; day: string; index: number };

/** Ledger launches by UTC day: those inside the data's days, and those outside it. Entries not launched are left out. */
export function placeMarkers(entries: readonly MarkerEntry[], days: readonly string[]): { inRange: Marker[]; outside: Omit<Marker, "index">[] } {
  const inRange: Marker[] = [];
  const outside: Omit<Marker, "index">[] = [];
  for (const e of entries) {
    if (e.launchedAt === null) continue;
    const day = e.launchedAt.slice(0, 10);
    const index = days.indexOf(day);
    if (index >= 0) inRange.push({ id: e.id, title: e.title, day, index });
    else outside.push({ id: e.id, title: e.title, day });
  }
  return { inRange, outside };
}

export type Side = { days: number; total: number; perDay: number };

/**
 * People reaching one step a day, averaged over up to `window` days before a marker and the same from the marker's day
 * on. Fewer days are used at the edges of the data, and the count is given. Null when either side has no days.
 */
export function beforeAfter(daily: readonly number[][], stepIndex: number, index: number, window: number): { before: Side; after: Side } | null {
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= daily.length) throw new RangeError("That is not a step.");
  if (!Number.isInteger(window) || window < 1) throw new RangeError("The window must be at least 1 day.");
  const d = daily[stepIndex];
  const before = d.slice(Math.max(0, index - window), index);
  const after = d.slice(index, index + window);
  if (before.length === 0 || after.length === 0) return null;
  const side = (xs: number[]): Side => {
    const total = xs.reduce((a, b) => a + b, 0);
    return { days: xs.length, total, perDay: total / xs.length };
  };
  return { before: side(before), after: side(after) };
}
