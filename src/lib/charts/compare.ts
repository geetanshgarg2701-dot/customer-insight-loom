import { formatPercent, formatSignedPoints } from "../app/format";
import { JOURNEY_STEPS } from "../demo/journeys";
import { toPlainRow } from "../duckdb/normalize";
import type { SqlEngine } from "../intake/types";
import { newcombeDifference, wilsonInterval } from "../stats/readout";
import { whereClause, type Selection } from "./crossfilter";

/**
 * Two groups on the same journey, side by side. For each step, the share of people who reached the step before and went
 * on to this one, with a Wilson interval, and the difference between the groups with a Newcombe interval. Everything is
 * computed in SQL counts and the readout statistics, never by a model.
 *
 * The groups are not registered in the ledger before a launch and several steps are compared at once, so every result is
 * labeled exploratory and association, and the count of comparisons is shown. No correction is applied, and the text says
 * so, because the screens that compare groups apply none yet.
 */

export const COMPARE_DIMENSIONS = ["channel", "segment"] as const;
export type CompareDimension = (typeof COMPARE_DIMENSIONS)[number];

/** Groups under this many people are shown muted with a warning. 30 is a judgment and the screen says so. */
export const MIN_GROUP = 30;

const ALPHA = 0.05;
const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;
const STEP_COLUMNS = ["s1", "s2", "s3", "s4"] as const;

export type StepRate = {
  step: string;
  /** People who reached the step before. */
  from: number;
  /** Of those, how many reached this step. */
  to: number;
  /** Null when nobody reached the step before, so there is nothing to measure. */
  rate: number | null;
  low: number | null;
  high: number | null;
};

export type GroupResult = {
  value: string;
  entered: number;
  /** People who reached each step, in step order. */
  reached: number[];
  rates: StepRate[];
  tooSmall: boolean;
};

export type StepDifference = {
  step: string;
  /** First group's rate minus the second group's rate. */
  difference: number;
  low: number;
  high: number;
  excludesZero: boolean;
};

export type Comparison = {
  dimension: CompareDimension;
  a: GroupResult;
  b: GroupResult;
  differences: StepDifference[];
  /** How many step differences were compared. A step with nobody to measure it on is not counted. */
  comparisons: number;
  note: string;
};

async function groupOf(
  engine: SqlEngine,
  table: string,
  dimension: CompareDimension,
  value: string,
  selection: Selection,
): Promise<GroupResult> {
  const where = whereClause(selection, dimension);
  const joiner = where.sql ? `${where.sql} AND` : "WHERE";
  const counts = STEP_COLUMNS.map((c) => `count(${c}) AS ${c}`).join(", ");
  const [row] = (
    await engine.query(`SELECT ${counts} FROM ${table} ${joiner} "${dimension}" = ?`, [...where.params, value])
  ).map(toPlainRow);
  const reached = STEP_COLUMNS.map((c) => Number(row[c]));
  const rates: StepRate[] = JOURNEY_STEPS.slice(1).map((step, i) => {
    const from = reached[i];
    const to = reached[i + 1];
    const label = `${JOURNEY_STEPS[i]} to ${step}`;
    if (from === 0) return { step: label, from, to, rate: null, low: null, high: null };
    const w = wilsonInterval(to, from, ALPHA);
    return { step: label, from, to, rate: to / from, low: w.low, high: w.high };
  });
  return { value, entered: reached[0], reached, rates, tooSmall: reached[0] < MIN_GROUP };
}

export async function compareGroups(
  engine: SqlEngine,
  table: string,
  input: { dimension: CompareDimension; a: string; b: string; selection: Selection },
): Promise<Comparison> {
  if (!TABLE_NAME.test(table)) throw new RangeError("Table name must be lower case letters, digits and underscores.");
  const { dimension, a, b, selection } = input;
  if (!(COMPARE_DIMENSIONS as readonly string[]).includes(dimension)) {
    throw new RangeError("Groups can be compared by channel or by segment.");
  }
  if (a === b) throw new RangeError("Choose two different groups to compare.");

  const [ga, gb] = await Promise.all([
    groupOf(engine, table, dimension, a, selection),
    groupOf(engine, table, dimension, b, selection),
  ]);

  const differences: StepDifference[] = [];
  ga.rates.forEach((ra, i) => {
    const rb = gb.rates[i];
    if (ra.rate === null || rb.rate === null) return;
    const n = newcombeDifference(ra.to, ra.from, rb.to, rb.from, ALPHA);
    differences.push({
      step: ra.step,
      difference: ra.rate - rb.rate,
      low: n.low,
      high: n.high,
      excludesZero: n.low > 0 || n.high < 0,
    });
  });

  const comparisons = differences.length;
  const note =
    `Comparisons made: ${comparisons}. ${comparisons} step ${comparisons === 1 ? "difference was" : "differences were"} ` +
    `compared between ${a} and ${b}. A difference is flagged only where its 95 percent interval excludes zero. Every ` +
    `result here is labeled exploratory, because the groups were not registered before a launch and no correction is ` +
    `applied across the comparisons. This is an association, not cause.`;

  return { dimension, a: ga, b: gb, differences, comparisons, note };
}

/**
 * One difference in plain words, with its interval, because intervals are often misread. It says what was compared,
 * whether the interval excludes zero, and that the result is exploratory and an association.
 */
export function differenceSentence(c: Comparison, d: StepDifference): string {
  const [fromStep, toStep] = d.step.split(" to ");
  const ra = c.a.rates.find((r) => r.step === d.step)!;
  const rb = c.b.rates.find((r) => r.step === d.step)!;
  const verdict = d.excludesZero
    ? "The interval excludes zero. This is still exploratory and an association, not a finding that one group causes the gap."
    : "The interval includes zero, so this does not show a gap. It is exploratory.";
  return (
    `Of people who reached ${fromStep}, ${formatPercent(ra.rate!, 1)} of ${c.a.value} went on to ${toStep}, ` +
    `against ${formatPercent(rb.rate!, 1)} of ${c.b.value}. The gap is ${formatSignedPoints(d.difference, 1)}, ` +
    `with a 95 percent interval of ${formatSignedPoints(d.low, 1)} to ${formatSignedPoints(d.high, 1)}. ${verdict}`
  );
}
