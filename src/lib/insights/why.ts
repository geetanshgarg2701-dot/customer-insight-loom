/**
 * The why panel, plan section 3: at the step chosen on the journeys screen, which themes and which segments go with
 * more people leaving there. A ranked list with counts and quotes, not a chart.
 *
 * Themes compare commenting customers who left at the step with those who went on: the share raising each theme.
 * Segments compare everyone in a segment and channel group with everyone else at the step: the share who left.
 * All of these are one discovery scan, so their p values are adjusted together with Benjamini Hochberg, and the number
 * of comparisons is shown. A side with fewer than 30 people is not compared. Every item is an association.
 */
import { MIN_GROUP } from "../charts/compare";
import { whereClause, type Selection } from "../charts/crossfilter";
import { JOURNEY_STEPS } from "../demo/journeys";
import { toPlainRow } from "../duckdb/normalize";
import type { SqlEngine } from "../intake/types";
import { benjaminiHochberg } from "../stats/bh";
import { newcombeDifference, twoProportionPValue } from "../stats/readout";
import { PAIN_LABELS } from "./comments";
import { THEMES } from "./evidence";

export const QUOTES_PER_ITEM = 3;
const Q = 0.05;
const ALPHA = 0.05;
const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;
const STEP_COLUMNS = ["s1", "s2", "s3", "s4"] as const;

export type Share = { x: number; n: number };
export type WhyItem = {
  kind: "theme" | "segment";
  /** The pain for a theme, or "segment|channel" for a segment. */
  key: string;
  label: string;
  /** Theme: those who left who raised it. Segment: people in the group who left. */
  a: Share;
  /** Theme: those who went on who raised it. Segment: everyone else at the step who left. */
  b: Share;
  difference: number;
  low: number;
  high: number;
  p: number;
  adjusted: number;
  flagged: boolean;
  quotes: { customer: number; text: string }[];
};

export type Why = {
  step: string;
  next: string | null;
  reached: number;
  left: number;
  commenters: { left: number; wentOn: number };
  comparisons: number;
  q: number;
  /** Every comparison made, flagged or not. */
  tested: WhyItem[];
  /** Flagged items where the gap goes with more leaving, largest gap first. */
  items: WhyItem[];
};

function compare(kind: WhyItem["kind"], key: string, label: string, a: Share, b: Share): Omit<WhyItem, "adjusted" | "flagged"> {
  const ci = newcombeDifference(a.x, a.n, b.x, b.n, ALPHA);
  return { kind, key, label, a, b, difference: a.x / a.n - b.x / b.n, low: ci.low, high: ci.high, p: twoProportionPValue(a.x, a.n, b.x, b.n), quotes: [] };
}

export async function whyAtStep(
  engine: SqlEngine,
  tables: { comments: string; journeys: string },
  stepIndex: number,
  selection: Selection,
): Promise<Why> {
  for (const t of [tables.comments, tables.journeys]) {
    if (!TABLE_NAME.test(t)) throw new RangeError("Table name must be lower case letters, digits and underscores.");
  }
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= JOURNEY_STEPS.length) {
    throw new RangeError("That is not a step in this journey.");
  }
  const step = JOURNEY_STEPS[stepIndex];
  const last = stepIndex === JOURNEY_STEPS.length - 1;
  const here = STEP_COLUMNS[stepIndex];
  const where = whereClause(selection);
  const atStep = `${where.sql ? `${where.sql} AND` : "WHERE"} ${here} IS NOT NULL`;

  const groups = (
    await engine.query(
      `SELECT segment, channel, count(*) AS reached, ${last ? "0" : `count(*) FILTER (WHERE ${STEP_COLUMNS[stepIndex + 1]} IS NULL)`} AS left_here ` +
        `FROM ${tables.journeys} ${atStep} GROUP BY 1, 2 ORDER BY 1, 2`,
      where.params,
    )
  ).map(toPlainRow);
  const reached = groups.reduce((n, g) => n + Number(g.reached), 0);
  if (last) {
    return { step, next: null, reached, left: 0, commenters: { left: 0, wentOn: 0 }, comparisons: 0, q: Q, tested: [], items: [] };
  }
  const left = groups.reduce((n, g) => n + Number(g.left_here), 0);
  const nextColumn = STEP_COLUMNS[stepIndex + 1];

  const themeRows = (
    await engine.query(
      `SELECT c.pain AS pain, (j.${nextColumn} IS NULL) AS stopped, count(*) AS n FROM ${tables.comments} c ` +
        `JOIN ${tables.journeys} j ON j.customer = c.customer ${atStep.replace(` ${here} IS`, ` j.${here} IS`)} GROUP BY 1, 2`,
      where.params,
    )
  ).map(toPlainRow);
  const count = (pain: string | null, stopped: boolean) =>
    themeRows.filter((r) => Boolean(r.stopped) === stopped && (pain === null || String(r.pain) === pain)).reduce((n, r) => n + Number(r.n), 0);
  const commenters = { left: count(null, true), wentOn: count(null, false) };

  const raw: Omit<WhyItem, "adjusted" | "flagged">[] = [];
  if (commenters.left >= MIN_GROUP && commenters.wentOn >= MIN_GROUP) {
    for (const pain of THEMES) {
      raw.push(compare("theme", pain, PAIN_LABELS[pain], { x: count(pain, true), n: commenters.left }, { x: count(pain, false), n: commenters.wentOn }));
    }
  }
  for (const g of groups) {
    const n = Number(g.reached);
    const x = Number(g.left_here);
    if (n < MIN_GROUP || reached - n < MIN_GROUP) continue;
    raw.push(compare("segment", `${String(g.segment)}|${String(g.channel)}`, `${String(g.segment)}, ${String(g.channel)}`, { x, n }, { x: left - x, n: reached - n }));
  }

  const bh = raw.length > 0 ? benjaminiHochberg(raw.map((r) => r.p), Q) : null;
  const tested: WhyItem[] = raw.map((r, i) => ({ ...r, adjusted: bh!.adjusted[i], flagged: bh!.rejected[i] }));
  const items = tested.filter((t) => t.flagged && t.difference > 0).sort((a, b) => b.difference - a.difference);

  // Supporting quotes for flagged themes: redacted text from customers who left at this step, in customer order.
  for (const item of items.filter((i) => i.kind === "theme")) {
    const quotes = (
      await engine.query(
        `SELECT c.customer AS customer, c.quote AS quote FROM ${tables.comments} c JOIN ${tables.journeys} j ON j.customer = c.customer ` +
          `${atStep.replace(` ${here} IS`, ` j.${here} IS`)} AND j.${nextColumn} IS NULL AND c.pain = ? ORDER BY c.customer LIMIT ${QUOTES_PER_ITEM}`,
        [...where.params, item.key],
      )
    ).map(toPlainRow);
    item.quotes = quotes.map((q) => ({ customer: Number(q.customer), text: String(q.quote) }));
  }

  return { step, next: JOURNEY_STEPS[stepIndex + 1], reached, left, commenters, comparisons: tested.length, q: Q, tested, items };
}
