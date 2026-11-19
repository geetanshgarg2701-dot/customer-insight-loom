import { PIPELINE_STAGES } from "../demo/pipeline";
import { toPlainRow } from "../duckdb/normalize";
import type { SqlEngine } from "../intake/types";
import { MIN_GROUP } from "./compare";
import { pipelineWhere, type PipelineSelection } from "./pipeline";

/**
 * Two pipeline views computed in SQL. The records behind a stage: the deals themselves, a page at a time, with how long
 * each spent in the stage and what happened next. And the pipeline as it stood on any past date, for the time scrubber.
 *
 * A deal has only a made up number. The same minimum as the journey views applies: records are listed only when at
 * least MIN_GROUP deals match, so a list can never pick out one account in a tiny group.
 */

const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;
const DAY_SECONDS = 86_400;
const MAX_PAGE = 100;

function checkTable(table: string): void {
  if (!TABLE_NAME.test(table)) throw new RangeError("Table name must be lower case letters, digits and underscores.");
}

/** A time as the text form the database reads, in UTC, to the second. */
function timestampText(value: string, label: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new RangeError(`The ${label} is not a time.`);
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

export type StageRecord = {
  label: string;
  segment: string;
  source: string;
  status: string;
  /** UTC date the deal entered this stage. */
  enteredAt: string;
  /** Days in this stage: to the next stage, to being marked lost, or to the cutoff if still open. Null after Won. */
  days: number | null;
  outcome: string;
};

export type StageRecords = {
  stage: string;
  which: "reached" | "open";
  groupSize: number;
  minGroup: number;
  hidden: boolean;
  records: StageRecord[];
  offset: number;
  of: number;
};

export async function stageRecords(
  engine: SqlEngine,
  table: string,
  selection: PipelineSelection,
  options: { stageIndex: number; which: "reached" | "open"; offset: number; limit: number; asOf: string },
): Promise<StageRecords> {
  checkTable(table);
  const { stageIndex: i, which, offset, limit } = options;
  if (!Number.isInteger(i) || i < 0 || i >= PIPELINE_STAGES.length) throw new RangeError("That is not a stage.");
  if (which !== "reached" && which !== "open") throw new RangeError("Show deals that reached the stage or are still open in it.");
  if (!Number.isInteger(offset) || offset < 0) throw new RangeError("The page must start at a whole number from 0.");
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) throw new RangeError(`A page holds 1 to ${MAX_PAGE} deals.`);
  const asOf = timestampText(options.asOf, "cutoff");

  const here = `e${i + 1}`;
  const last = i === PIPELINE_STAGES.length - 1;
  const next = last ? null : `e${i + 2}`;
  const where = pipelineWhere(selection);
  const joiner = where.sql ? `${where.sql} AND` : "WHERE";
  const openFilter = which === "open" ? ` AND status = 'open' AND stage = ?` : "";
  const filterParams = which === "open" ? [PIPELINE_STAGES[i]] : [];

  const [countRow] = (
    await engine.query(`SELECT count(*) AS n FROM ${table} ${joiner} ${here} IS NOT NULL${openFilter}`, [...where.params, ...filterParams])
  ).map(toPlainRow);
  const groupSize = Number(countRow.n);
  const base = { stage: PIPELINE_STAGES[i], which, groupSize, minGroup: MIN_GROUP, offset, of: groupSize };
  if (groupSize < MIN_GROUP) return { ...base, hidden: true, records: [] };

  const days = last
    ? "NULL"
    : `date_diff('second', ${here}, COALESCE(${next}, lost_at, CAST(? AS TIMESTAMP))) / ${DAY_SECONDS}.0`;
  const rows = (
    await engine.query(
      `SELECT deal, segment, source, status, ${here} AS entered_at, ${next ?? "NULL"} AS next_at, ${days} AS days ` +
        `FROM ${table} ${joiner} ${here} IS NOT NULL${openFilter} ORDER BY deal LIMIT ${limit} OFFSET ${offset}`,
      [...(last ? [] : [asOf]), ...where.params, ...filterParams],
    )
  ).map(toPlainRow);

  const records = rows.map((r): StageRecord => {
    const status = String(r.status);
    const outcome = last
      ? "Won"
      : r.next_at !== null
        ? `Moved to ${PIPELINE_STAGES[i + 1]}`
        : status === "lost"
          ? "Lost"
          : "Still open here";
    return {
      label: `Synthetic deal ${Number(r.deal)}`,
      segment: String(r.segment),
      source: String(r.source),
      status,
      enteredAt: new Date(Number(r.entered_at)).toISOString().slice(0, 10),
      days: r.days === null ? null : Number(r.days),
      outcome,
    };
  });
  return { ...base, hidden: false, records };
}

export type PipelineAt = {
  /** The date, as given. */
  at: string;
  /** Deals that had entered the pipeline by then. */
  entered: number;
  /** Deals open in Lead, Qualified and Proposal on that date. */
  open: number[];
  /** Won by then. */
  won: number;
  /** Marked lost by then. */
  lost: number;
};

/** The pipeline as it stood on a date. A deal counts in a stage from the moment it enters, so no deal counts twice. */
export async function pipelineAt(engine: SqlEngine, table: string, selection: PipelineSelection, at: string): Promise<PipelineAt> {
  checkTable(table);
  const d = timestampText(at, "date");
  const where = pipelineWhere(selection);
  const stillOpen = (col: string, nextCol: string) =>
    `count(*) FILTER (WHERE ${col} <= d.at AND (${nextCol} IS NULL OR ${nextCol} > d.at) AND (lost_at IS NULL OR lost_at > d.at))`;
  const [row] = (
    await engine.query(
      `WITH d AS (SELECT CAST(? AS TIMESTAMP) AS at) SELECT ` +
        `count(*) FILTER (WHERE e1 <= d.at) AS entered, ` +
        `${stillOpen("e1", "e2")} AS o1, ${stillOpen("e2", "e3")} AS o2, ${stillOpen("e3", "e4")} AS o3, ` +
        `count(*) FILTER (WHERE e4 <= d.at) AS won, count(*) FILTER (WHERE lost_at <= d.at) AS lost ` +
        `FROM ${table}, d ${where.sql}`,
      [d, ...where.params],
    )
  ).map(toPlainRow);
  return {
    at,
    entered: Number(row.entered),
    open: [Number(row.o1), Number(row.o2), Number(row.o3)],
    won: Number(row.won),
    lost: Number(row.lost),
  };
}

/** Dates for the scrubber: every `stepDays` from the first entry, always ending on the cutoff. */
export function scrubberDates(first: string, last: string, stepDays: number): string[] {
  const a = Date.parse(first);
  const b = Date.parse(last);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) throw new RangeError("The range must run forward in time.");
  if (!Number.isFinite(stepDays) || stepDays <= 0) throw new RangeError("The step must be a number of days above 0.");
  const out: string[] = [];
  for (let t = a; t < b; t += stepDays * DAY_SECONDS * 1000) out.push(new Date(t).toISOString());
  out.push(new Date(b).toISOString());
  return out;
}

/** The earliest time any deal entered the pipeline, as a UTC ISO time, where the scrubber starts. */
export async function firstEntry(engine: SqlEngine, table: string): Promise<string> {
  checkTable(table);
  const [row] = (await engine.query(`SELECT min(e1) AS first FROM ${table}`, [])).map(toPlainRow);
  if (row.first === null) throw new RangeError("No deal has entered the pipeline.");
  return new Date(Number(row.first)).toISOString();
}

const MAX_DATES = 400;

/**
 * The pipeline as it stood on many dates, in one query, so the scrubber can move without asking the database again and
 * the chart can use one fixed scale for every date. Same rules as pipelineAt, checked against it date by date.
 */
export async function pipelineSeries(
  engine: SqlEngine,
  table: string,
  selection: PipelineSelection,
  dates: readonly string[],
): Promise<PipelineAt[]> {
  checkTable(table);
  if (dates.length === 0 || dates.length > MAX_DATES) throw new RangeError(`Give 1 to ${MAX_DATES} dates.`);
  // Each date is parsed and rewritten as plain digits before it goes into the query, so no text from outside reaches it.
  const texts = dates.map((d) => timestampText(d, "date"));
  const values = texts.map((t, k) => `(${k}, CAST('${t}' AS TIMESTAMP))`).join(", ");
  const where = pipelineWhere(selection);
  const stillOpen = (col: string, nextCol: string) =>
    `count(*) FILTER (WHERE ${col} <= d.ts AND (${nextCol} IS NULL OR ${nextCol} > d.ts) AND (lost_at IS NULL OR lost_at > d.ts))`;
  const rows = (
    await engine.query(
      `WITH d(k, ts) AS (VALUES ${values}) SELECT d.k AS k, ` +
        `count(*) FILTER (WHERE e1 <= d.ts) AS entered, ` +
        `${stillOpen("e1", "e2")} AS o1, ${stillOpen("e2", "e3")} AS o2, ${stillOpen("e3", "e4")} AS o3, ` +
        `count(*) FILTER (WHERE e4 <= d.ts) AS won, count(*) FILTER (WHERE lost_at <= d.ts) AS lost ` +
        `FROM ${table} CROSS JOIN d ${where.sql} GROUP BY d.k`,
      where.params,
    )
  ).map(toPlainRow);
  const byK = new Map(rows.map((r) => [Number(r.k), r]));
  return dates.map((at, k) => {
    const r = byK.get(k);
    return {
      at,
      entered: Number(r?.entered ?? 0),
      open: [Number(r?.o1 ?? 0), Number(r?.o2 ?? 0), Number(r?.o3 ?? 0)],
      won: Number(r?.won ?? 0),
      lost: Number(r?.lost ?? 0),
    };
  });
}
