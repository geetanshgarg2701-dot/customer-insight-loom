/**
 * What the comments screen may ask of its data. Fixed questions only, never arbitrary SQL. Raw comment text goes in,
 * is redacted before anything is stored, and only redacted text ever comes back out.
 */
import { loadJourneys } from "../charts/crossfilter";
import type { JourneyRow } from "../demo/journeys";
import { toPlainRow } from "../duckdb/normalize";
import type { SqlEngine } from "../intake/types";
import { PAINS, type Pain, type SyntheticComment } from "./comments";
import { CARRIER_SHARE, customerRevenue, dropOffLinks, loadRevenue, painRanking, segmentCarriers, type Carrier, type DropLinks, type RankRow } from "./evidence";
import { loadComments, mentionRates, type MentionDimension, type MentionRates } from "./mentions";
import { prepareComments, reRedact, type CommentRow, type Scorecard } from "./prepare";

export const QUOTE_PAGE = 10;

export type QuoteRow = {
  customer: number;
  text: string;
  severity: number;
  segment: string;
  channel: string;
  reached: string;
};
export type QuotePage = { total: number; offset: number; rows: QuoteRow[] };

export type CommentsBoard = {
  kept: number;
  withheld: number;
  scorecard: Scorecard;
  mentions(dimension: MentionDimension): Promise<MentionRates>;
  quotes(pain: Pain, offset: number): Promise<QuotePage>;
  /** Redacts the edited text again, stores it, and returns what was stored and how many details were removed. */
  correct(customer: number, text: string): Promise<{ text: string; removed: number }>;
  ranking(): Promise<RankRow[]>;
  drops(): Promise<DropLinks>;
  carriers(threshold?: number): Promise<Carrier[]>;
  close(): Promise<void>;
};

/**
 * Names of its own, because every screen shares one in-browser database and the journeys screen drops its own
 * "journeys" table when it closes. With shared names, one screen closing could drop a table the other had just
 * loaded. That race was not reproduced in a test, so this guards a risk, not a seen failure.
 */
export const TABLES = { comments: "insight_comments", journeys: "insight_journeys", revenue: "insight_revenue" } as const;

export async function createCommentsBoard(
  engine: SqlEngine,
  journeys: readonly JourneyRow[],
  comments: readonly SyntheticComment[],
  revenue: readonly number[] = customerRevenue(journeys, 31),
): Promise<CommentsBoard> {
  const prepared = prepareComments(comments);
  await loadJourneys(engine, TABLES.journeys, journeys);
  await loadComments(engine, TABLES.comments, prepared.rows);
  await loadRevenue(engine, TABLES.revenue, revenue);
  const rows = new Map<number, CommentRow>(prepared.rows.map((r) => [r.customer, r]));

  return {
    kept: prepared.rows.length,
    withheld: prepared.withheld,
    scorecard: prepared.scorecard,
    mentions: (dimension) => mentionRates(engine, TABLES, dimension),
    async quotes(pain, offset) {
      if (!(PAINS as readonly string[]).includes(pain)) throw new RangeError("That is not a coded pain.");
      if (!Number.isInteger(offset) || offset < 0) throw new RangeError("The page start must be a whole number, 0 or more.");
      const total = Number(
        toPlainRow((await engine.query(`SELECT count(*) AS n FROM ${TABLES.comments} WHERE pain = ?`, [pain]))[0]).n,
      );
      const found = (
        await engine.query(
          `SELECT c.customer, c.quote, c.severity, j.segment, j.channel, j.reached FROM ${TABLES.comments} c ` +
            `JOIN ${TABLES.journeys} j ON j.customer = c.customer WHERE c.pain = ? ORDER BY c.customer LIMIT ${QUOTE_PAGE} OFFSET ?`,
          [pain, offset],
        )
      ).map(toPlainRow);
      return {
        total,
        offset,
        rows: found.map((r) => ({
          customer: Number(r.customer),
          text: String(r.quote),
          severity: Number(r.severity),
          segment: String(r.segment),
          channel: String(r.channel),
          reached: String(r.reached),
        })),
      };
    },
    async correct(customer, text) {
      const row = rows.get(customer);
      if (!row) throw new RangeError("There is no stored comment for that customer.");
      const next = reRedact(row, text);
      await engine.query(`UPDATE ${TABLES.comments} SET quote = ?, rule_version = ? WHERE customer = ?`, [
        next.quote.text,
        next.quote.stamp.ruleVersion,
        customer,
      ]);
      rows.set(customer, next);
      const removed = Object.values(next.quote.stamp.counts).reduce((n, k) => n + k, 0);
      return { text: next.quote.text, removed };
    },
    ranking: () => painRanking(engine, TABLES),
    drops: () => dropOffLinks(engine, TABLES),
    carriers: (threshold = CARRIER_SHARE) => segmentCarriers(engine, TABLES, threshold),
    async close() {
      await engine.exec(`DROP TABLE IF EXISTS ${TABLES.comments}`);
      await engine.exec(`DROP TABLE IF EXISTS ${TABLES.journeys}`);
      await engine.exec(`DROP TABLE IF EXISTS ${TABLES.revenue}`);
      await engine.close?.();
    },
  };
}
