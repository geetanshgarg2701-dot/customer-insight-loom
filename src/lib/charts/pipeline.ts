import { toPlainRow } from "../duckdb/normalize";
import { PIPELINE_STAGES, type PipelineRow } from "../demo/pipeline";
import type { SqlEngine } from "../intake/types";
import { insertRows } from "../ledger/ledger";
import { buildWhere } from "./crossfilter";

/**
 * Queries for the pipeline views, plan module M17. The same rules as the journey charts: column names come from a
 * fixed list, values are bound as parameters, and a chart ignores its own selection. All times are UTC. Time in a
 * stage is elapsed time, never calendar days, so a clock change cannot move it.
 */

export const PIPELINE_DIMENSIONS = ["segment", "source", "stage"] as const;
export type PipelineDimension = (typeof PIPELINE_DIMENSIONS)[number];
export type PipelineSelection = Partial<Record<PipelineDimension, string[]>>;

const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;
const STAGE_COLUMNS = ["e1", "e2", "e3", "e4"] as const;
const DAY_SECONDS = 86_400;

function checkTable(table: string): void {
  if (!TABLE_NAME.test(table)) throw new RangeError("Table name must be lower case letters, digits and underscores.");
}

export function pipelineWhere(selection: PipelineSelection, except?: string): { sql: string; params: string[] } {
  return buildWhere(selection, PIPELINE_DIMENSIONS, except);
}

export async function loadPipeline(engine: SqlEngine, table: string, rows: readonly PipelineRow[]): Promise<void> {
  checkTable(table);
  await engine.exec(
    `CREATE OR REPLACE TABLE ${table} (segment VARCHAR, source VARCHAR, e1 TIMESTAMP, e2 TIMESTAMP, e3 TIMESTAMP, e4 TIMESTAMP, stage VARCHAR)`,
  );
  await insertRows(
    engine,
    table,
    ["segment", "source", ...STAGE_COLUMNS, "stage"],
    rows.map((r) => [r.segment, r.source, ...r.entered, r.stage]),
  );
}

export type Count = { value: string; count: number };

export async function pipelineCounts(
  engine: SqlEngine,
  table: string,
  dimension: string,
  selection: PipelineSelection,
): Promise<Count[]> {
  checkTable(table);
  if (!(PIPELINE_DIMENSIONS as readonly string[]).includes(dimension)) throw new RangeError("That is not a chart dimension.");
  const where = pipelineWhere(selection, dimension);
  const rows = await engine.query(
    `SELECT "${dimension}" AS value, count(*) AS count FROM ${table} ${where.sql} GROUP BY 1 ORDER BY 1`,
    where.params,
  );
  return rows.map(toPlainRow).map((r) => ({ value: String(r.value), count: Number(r.count) }));
}

export type FunnelStage = { stage: string; count: number; /** Share of the previous stage that got here. */ conversion: number };

/** How many deals reached each stage, and the share of the stage before that made it. */
export async function stageFunnel(engine: SqlEngine, table: string, selection: PipelineSelection): Promise<FunnelStage[]> {
  checkTable(table);
  const where = pipelineWhere(selection);
  const [row] = (
    await engine.query(
      `SELECT ${STAGE_COLUMNS.map((c, i) => `count(*) FILTER (WHERE ${c} IS NOT NULL) AS c${i}`).join(", ")} FROM ${table} ${where.sql}`,
      where.params,
    )
  ).map(toPlainRow);
  const counts = STAGE_COLUMNS.map((_, i) => Number(row[`c${i}`]));
  return PIPELINE_STAGES.map((stage, i) => ({
    stage,
    count: counts[i],
    conversion: i === 0 ? 1 : counts[i - 1] === 0 ? 0 : counts[i] / counts[i - 1],
  }));
}

export type DwellHistogram = {
  from: string;
  to: string;
  /** Deals that moved on from `from` to `to`. Deals still waiting are not in it. */
  moved: number;
  /** Width of a bin in days. The last bin holds everything at or above it. */
  binDays: number;
  bins: { fromDay: number; count: number }[];
  medianDays: number;
  p90Days: number;
};

/** Days spent in one stage before moving to the next, for the deals that did move. */
export async function dwellHistogram(
  engine: SqlEngine,
  table: string,
  stageIndex: number,
  selection: PipelineSelection,
  binDays = 3,
  maxBin = 60,
): Promise<DwellHistogram> {
  checkTable(table);
  if (!Number.isInteger(stageIndex) || stageIndex < 0 || stageIndex > 2) {
    throw new RangeError("Time in stage needs a stage that has a next stage.");
  }
  if (!(binDays > 0) || !(maxBin >= binDays)) throw new RangeError("Bins must be above 0 days wide.");
  const from = STAGE_COLUMNS[stageIndex];
  const to = STAGE_COLUMNS[stageIndex + 1];
  const where = pipelineWhere(selection);
  const joiner = where.sql ? `${where.sql} AND` : "WHERE";
  const days = `date_diff('second', ${from}, ${to}) / ${DAY_SECONDS}.0`;

  const bins = (
    await engine.query(
      `SELECT LEAST(FLOOR(${days} / ?) * ?, ?) AS bin, count(*) AS count FROM ${table} ${joiner} ${to} IS NOT NULL GROUP BY 1 ORDER BY 1`,
      // The bin placeholders come first in the text, so they come first here.
      [binDays, binDays, maxBin, ...where.params],
    )
  ).map(toPlainRow);
  const [stats] = (
    await engine.query(
      `SELECT count(*) AS moved, quantile_cont(${days}, 0.5) AS median, quantile_cont(${days}, 0.9) AS p90 FROM ${table} ${joiner} ${to} IS NOT NULL`,
      where.params,
    )
  ).map(toPlainRow);
  return {
    from: PIPELINE_STAGES[stageIndex],
    to: PIPELINE_STAGES[stageIndex + 1],
    moved: Number(stats.moved),
    binDays,
    bins: bins.map((b) => ({ fromDay: Number(b.bin), count: Number(b.count) })),
    medianDays: Number(stats.median ?? 0),
    p90Days: Number(stats.p90 ?? 0),
  };
}

export type Stalled = { stage: string; count: number; medianIdleDays: number };

/**
 * Open deals with no movement for at least `thresholdDays` as of a cutoff, by the stage they are stuck in. A won deal
 * is never stalled. Idle time is elapsed time since the last stage entry.
 */
export async function stalledByStage(
  engine: SqlEngine,
  table: string,
  options: { thresholdDays: number; asOf: string },
  selection: PipelineSelection,
): Promise<Stalled[]> {
  checkTable(table);
  if (!Number.isFinite(options.thresholdDays) || options.thresholdDays < 0) {
    throw new RangeError("The stalled threshold must be 0 days or more.");
  }
  const asOfMs = Date.parse(options.asOf);
  if (!Number.isFinite(asOfMs)) throw new RangeError("The cutoff is not a time.");
  const asOf = new Date(asOfMs).toISOString().slice(0, 19).replace("T", " ");
  const where = pipelineWhere(selection);

  const rows = await engine.query(
    `SELECT stage, count(*) AS count, quantile_cont(idle, 0.5) AS median FROM (` +
      `SELECT stage, date_diff('second', COALESCE(e4, e3, e2, e1), CAST(? AS TIMESTAMP)) / ${DAY_SECONDS}.0 AS idle ` +
      `FROM ${table} ${where.sql}) WHERE stage <> 'Won' AND idle >= ? GROUP BY stage ` +
      `ORDER BY CASE stage ${PIPELINE_STAGES.map((s, i) => `WHEN '${s}' THEN ${i}`).join(" ")} ELSE 9 END`,
    [asOf, ...where.params, options.thresholdDays],
  );
  return rows.map(toPlainRow).map((r) => ({
    stage: String(r.stage),
    count: Number(r.count),
    medianIdleDays: Number(r.median),
  }));
}
