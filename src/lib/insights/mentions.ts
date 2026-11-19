/**
 * How often each pain is mentioned, by a group taken from what customers did. The comments table holds only redacted
 * quotes, and every group comes from joining it to the journeys table on the customer, so a group is a fact about
 * behavior and the rate is a fact about words. A difference between groups is an association, never a cause.
 *
 * Column and table names come from fixed lists in code and are never taken from the page.
 */
import { MIN_GROUP } from "../charts/compare";
import { CHANNELS, JOURNEY_STEPS, SEGMENTS } from "../demo/journeys";
import { toPlainRow } from "../duckdb/normalize";
import type { SqlEngine } from "../intake/types";
import { insertRows } from "../ledger/ledger";
import { isRedactedQuote, UnredactedQuoteError } from "../redaction/quote";
import { wilsonInterval } from "../stats/readout";
import { PAINS, type Pain } from "./comments";
import type { CommentRow } from "./prepare";

const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;
const ALPHA = 0.05;

function checkTable(table: string): void {
  if (!TABLE_NAME.test(table)) throw new RangeError("Table name must be lower case letters, digits and underscores.");
}

/** Stores comments. Every quote is checked before anything is written, so one forged quote stores nothing at all. */
export async function loadComments(engine: SqlEngine, table: string, rows: readonly CommentRow[]): Promise<void> {
  checkTable(table);
  for (const r of rows) if (!isRedactedQuote(r.quote)) throw new UnredactedQuoteError();
  await engine.exec(
    `CREATE OR REPLACE TABLE ${table} (customer INTEGER, pain VARCHAR, severity INTEGER, quote VARCHAR, rule_version VARCHAR)`,
  );
  await insertRows(
    engine,
    table,
    ["customer", "pain", "severity", "quote", "rule_version"],
    rows.map((r) => [r.customer, r.pain, r.severity, r.quote.text, r.quote.stamp.ruleVersion]),
  );
}

export const MENTION_DIMENSIONS = ["reached", "segment", "channel", "support"] as const;
export type MentionDimension = (typeof MENTION_DIMENSIONS)[number];

const USED = "used Support";
const NOT_USED = "no Support";

const EXPRESSION: Readonly<Record<MentionDimension, string>> = {
  reached: "j.reached",
  segment: "j.segment",
  channel: "j.channel",
  support: `CASE WHEN j.path LIKE '%Support%' THEN '${USED}' ELSE '${NOT_USED}' END`,
};

const ORDER: Readonly<Record<MentionDimension, readonly string[]>> = {
  reached: JOURNEY_STEPS,
  segment: SEGMENTS,
  channel: CHANNELS,
  support: [USED, NOT_USED],
};

export type PainRate = { pain: Pain; mentions: number; rate: number; low: number; high: number };
export type MentionGroup = { value: string; comments: number; tooSmall: boolean; pains: PainRate[] };
export type MentionRates = { dimension: MentionDimension; overall: MentionGroup; groups: MentionGroup[]; unlinked: number };

function group(value: string, counts: ReadonlyMap<string, number>): MentionGroup {
  const comments = PAINS.reduce((n, p) => n + (counts.get(p) ?? 0), 0);
  if (comments < MIN_GROUP) return { value, comments, tooSmall: true, pains: [] };
  const pains = PAINS.map((p) => {
    const mentions = counts.get(p) ?? 0;
    const w = wilsonInterval(mentions, comments, ALPHA);
    return { pain: p, mentions, rate: mentions / comments, low: w.low, high: w.high };
  });
  return { value, comments, tooSmall: false, pains };
}

/** Mention rate of every pain in every group of one dimension, with 95 percent Wilson intervals. */
export async function mentionRates(
  engine: SqlEngine,
  tables: { comments: string; journeys: string },
  dimension: MentionDimension,
): Promise<MentionRates> {
  checkTable(tables.comments);
  checkTable(tables.journeys);
  if (!(MENTION_DIMENSIONS as readonly string[]).includes(dimension)) throw new RangeError("That is not a grouping for mentions.");
  const rows = (
    await engine.query(
      `SELECT ${EXPRESSION[dimension]} AS value, c.pain AS pain, count(*) AS n FROM ${tables.comments} c ` +
        `JOIN ${tables.journeys} j ON j.customer = c.customer GROUP BY 1, 2`,
      [],
    )
  ).map(toPlainRow);
  const unlinkedRow = (
    await engine.query(
      `SELECT count(*) AS n FROM ${tables.comments} c WHERE NOT EXISTS ` +
        `(SELECT 1 FROM ${tables.journeys} j WHERE j.customer = c.customer)`,
      [],
    )
  ).map(toPlainRow)[0];

  const byGroup = new Map<string, Map<string, number>>();
  const overall = new Map<string, number>();
  for (const r of rows) {
    const value = String(r.value);
    const p = String(r.pain);
    const n = Number(r.n);
    if (!byGroup.has(value)) byGroup.set(value, new Map());
    byGroup.get(value)!.set(p, n);
    overall.set(p, (overall.get(p) ?? 0) + n);
  }
  const groups = ORDER[dimension].filter((v) => byGroup.has(v)).map((v) => group(v, byGroup.get(v)!));
  return { dimension, overall: group("All comments", overall), groups, unlinked: Number(unlinkedRow.n) };
}
