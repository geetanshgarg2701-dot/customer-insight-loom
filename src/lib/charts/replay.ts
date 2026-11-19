import { JOURNEY_STEPS } from "../demo/journeys";
import { toPlainRow } from "../duckdb/normalize";
import type { SqlEngine } from "../intake/types";
import { MIN_GROUP } from "./compare";
import { whereClause, type Selection } from "./crossfilter";

/**
 * Replay of one anonymized customer path: the events in time order, with the time since entry and since the step
 * before. The customer has only a made up label. The data holds no email or name, and none is ever added here.
 *
 * Individual paths are for authorized users only in the plan, and the public demo has no accounts. So the code also
 * enforces the group rule: a single path is shown only when at least MIN_GROUP people match the selection, so a path
 * can never single out someone in a small group. Under the minimum, no events are returned at all.
 */

const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;
const PATH_SEPARATOR = " > ";
const HOUR_MS = 3_600_000;

export type ReplayEvent = {
  step: string;
  /** UTC time of the event. */
  at: string;
  hoursSinceEntry: number;
  /** Null for the first event. */
  hoursSincePrevious: number | null;
};

export type ExampleJourney = {
  hidden: boolean;
  /** How many customers match the selection and the outcome. */
  groupSize: number;
  minGroup: number;
  label: string;
  segment: string | null;
  channel: string | null;
  events: ReplayEvent[];
  /** Which matching customer this is, counting from 1, and how many match. */
  position: number;
  of: number;
};

export async function exampleJourney(
  engine: SqlEngine,
  table: string,
  selection: Selection,
  options: { reached: string; offset: number },
): Promise<ExampleJourney> {
  if (!TABLE_NAME.test(table)) throw new RangeError("Table name must be lower case letters, digits and underscores.");
  if (!(JOURNEY_STEPS as readonly string[]).includes(options.reached)) {
    throw new RangeError("That is not a furthest step in this journey.");
  }
  if (!Number.isInteger(options.offset) || options.offset < 0) {
    throw new RangeError("The customer number must be a whole number from 0.");
  }

  // The choice of outcome sets the furthest step, so a filter on it is left out here.
  const where = whereClause(selection, "reached");
  const joiner = where.sql ? `${where.sql} AND` : "WHERE";
  const params = [...where.params, options.reached];
  const [countRow] = (
    await engine.query(`SELECT count(*) AS n FROM ${table} ${joiner} reached = ?`, params)
  ).map(toPlainRow);
  const groupSize = Number(countRow.n);

  if (groupSize < MIN_GROUP) {
    return {
      hidden: true,
      groupSize,
      minGroup: MIN_GROUP,
      label: `Hidden, only ${groupSize} ${groupSize === 1 ? "person matches" : "people match"} and the minimum is ${MIN_GROUP}`,
      segment: null,
      channel: null,
      events: [],
      position: 0,
      of: groupSize,
    };
  }

  const position = options.offset % groupSize;
  const [row] = (
    await engine.query(
      `SELECT customer, segment, channel, path, times FROM ${table} ${joiner} reached = ? ORDER BY customer LIMIT 1 OFFSET ${position}`,
      params,
    )
  ).map(toPlainRow);

  const steps = String(row.path).split(PATH_SEPARATOR);
  const times = String(row.times).split(PATH_SEPARATOR);
  const entry = Date.parse(times[0]);
  const events: ReplayEvent[] = steps.map((step, i) => ({
    step,
    at: times[i],
    hoursSinceEntry: (Date.parse(times[i]) - entry) / HOUR_MS,
    hoursSincePrevious: i === 0 ? null : (Date.parse(times[i]) - Date.parse(times[i - 1])) / HOUR_MS,
  }));

  return {
    hidden: false,
    groupSize,
    minGroup: MIN_GROUP,
    label: `Synthetic customer ${Number(row.customer)}`,
    segment: String(row.segment),
    channel: String(row.channel),
    events,
    position: position + 1,
    of: groupSize,
  };
}
