import { toPlainRow } from "../duckdb/normalize";
import { PIPELINE_STAGES, type PipelineRow } from "../demo/pipeline";
import type { SqlEngine } from "../intake/types";
import { insertRows } from "../ledger/ledger";
import { newcombeDifference, wilsonInterval, type Interval } from "../stats/readout";
import { buildWhere } from "./crossfilter";

/**
 * Queries for the pipeline views, plan module M17. The same rules as the journey charts: column names come from a
 * fixed list, values are bound as parameters, and a chart ignores its own selection. All times are UTC. Time in a
 * stage is elapsed time, never calendar days, so a clock change cannot move it.
 */

export const PIPELINE_DIMENSIONS = ["segment", "source", "stage", "status"] as const;
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
    `CREATE OR REPLACE TABLE ${table} (deal INTEGER, segment VARCHAR, source VARCHAR, e1 TIMESTAMP, e2 TIMESTAMP, e3 TIMESTAMP, e4 TIMESTAMP, stage VARCHAR, lost_at TIMESTAMP, status VARCHAR)`,
  );
  // deal is the row's position, a made up number used only to list and page through records.
  await insertRows(
    engine,
    table,
    ["deal", "segment", "source", ...STAGE_COLUMNS, "stage", "lost_at", "status"],
    rows.map((r, i) => [i, r.segment, r.source, ...r.entered, r.stage, r.lostAt, r.status]),
  );
}

/** A timestamp from the database arrives as milliseconds since 1970 in UTC. Anything else is treated as missing. */
function timeOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
 * and a lost deal are closed, so neither is ever stalled. Idle time is elapsed time since the last stage entry.
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
      `SELECT stage, status, date_diff('second', COALESCE(e4, e3, e2, e1), CAST(? AS TIMESTAMP)) / ${DAY_SECONDS}.0 AS idle ` +
      `FROM ${table} ${where.sql}) WHERE status = 'open' AND idle >= ? GROUP BY stage ` +
      `ORDER BY CASE stage ${PIPELINE_STAGES.map((s, i) => `WHEN '${s}' THEN ${i}`).join(" ")} ELSE 9 END`,
    [asOf, ...where.params, options.thresholdDays],
  );
  return rows.map(toPlainRow).map((r) => ({
    stage: String(r.stage),
    count: Number(r.count),
    medianIdleDays: Number(r.median),
  }));
}

export type CohortRow = {
  /** The month the deals entered the first stage, in UTC, as YYYY-MM. */
  cohort: string;
  deals: number;
  /** Deals that reached each stage within the window of entering. */
  reachedQualified: number;
  reachedProposal: number;
  reachedWon: number;
  qualifiedShare: number;
  proposalShare: number;
  wonShare: number;
  /** True when the newest deal in the cohort has had the whole window by the cutoff, so cohorts compare fairly. */
  mature: boolean;
  latestEntry: string | null;
};

/**
 * Do newer cohorts reach stages faster or slower? Shares are of the deals that entered in that month, counting only
 * stage entries within `windowDays` of entering, elapsed time, closing instant inside. A cohort whose newest deal has
 * not had the whole window is flagged as still maturing, because comparing it with older cohorts would be unfair.
 */
export async function cohortLadder(
  engine: SqlEngine,
  table: string,
  options: { windowDays: number; asOf: string },
  selection: PipelineSelection,
): Promise<CohortRow[]> {
  checkTable(table);
  if (!Number.isFinite(options.windowDays) || options.windowDays <= 0) {
    throw new RangeError("The window must be above 0 days.");
  }
  const asOfMs = Date.parse(options.asOf);
  if (!Number.isFinite(asOfMs)) throw new RangeError("The cutoff is not a time.");
  const asOf = new Date(asOfMs).toISOString().slice(0, 19).replace("T", " ");
  const windowSeconds = Math.round(options.windowDays * DAY_SECONDS);
  const where = pipelineWhere(selection);
  const within = (c: string) => `count(*) FILTER (WHERE ${c} IS NOT NULL AND date_diff('second', e1, ${c}) <= ${windowSeconds})`;

  const rows = await engine.query(
    `SELECT strftime(e1, '%Y-%m') AS cohort, count(*) AS deals, ` +
      `${within("e2")} AS q, ${within("e3")} AS p, ${within("e4")} AS w, ` +
      `max(e1) AS latest, max(e1) <= CAST(? AS TIMESTAMP) - to_seconds(${windowSeconds}) AS mature ` +
      `FROM ${table} ${where.sql} GROUP BY 1 ORDER BY 1`,
    [asOf, ...where.params],
  );
  return rows.map(toPlainRow).map((r) => {
    const deals = Number(r.deals);
    const share = (n: unknown) => (deals === 0 ? 0 : Number(n) / deals);
    return {
      cohort: String(r.cohort),
      deals,
      reachedQualified: Number(r.q),
      reachedProposal: Number(r.p),
      reachedWon: Number(r.w),
      qualifiedShare: share(r.q),
      proposalShare: share(r.p),
      wonShare: share(r.w),
      mature: Boolean(r.mature),
      latestEntry: timeOf(r.latest) === null ? null : new Date(timeOf(r.latest)!).toISOString(),
    };
  });
}

const DAY_MS = 86_400_000;
/** 13 weeks, so a period always holds whole weeks and the two periods have the same length. */
const PERIOD_DAYS = 91;

export type Period = { from: string; to: string };

/**
 * The two periods to compare by default: the latest 13 weeks of deals that have all had the whole window by the
 * cutoff, and the 13 weeks before them. The newest deals are left out on purpose, because a deal that has not had the
 * whole window yet would make the later period look worse than it is.
 */
export function defaultPeriods(
  asOf: string,
  windowDays: number,
): { cutoff: string; earlier: Period; later: Period } {
  const asOfMs = Date.parse(asOf);
  if (!Number.isFinite(asOfMs)) throw new RangeError("The cutoff is not a time.");
  if (!Number.isFinite(windowDays) || windowDays <= 0) throw new RangeError("The window must be above 0 days.");
  const cutoff = asOfMs - windowDays * DAY_MS;
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    cutoff: iso(cutoff),
    later: { from: iso(cutoff - PERIOD_DAYS * DAY_MS), to: iso(cutoff) },
    earlier: { from: iso(cutoff - 2 * PERIOD_DAYS * DAY_MS), to: iso(cutoff - PERIOD_DAYS * DAY_MS) },
  };
}

export type PeriodStats = Period & {
  deals: number;
  /** True when the newest deal in the period has had the whole window by the cutoff. */
  comparable: boolean;
  latestEntry: string | null;
};

export type PeriodRow = {
  stage: string;
  earlier: { reached: number; share: number };
  later: { reached: number; share: number };
  /** Later share minus earlier share, as a proportion. */
  difference: number;
  interval: Interval;
  /** True when the interval excludes zero. */
  significant: boolean;
};

export type PeriodComparison = {
  windowDays: number;
  earlier: PeriodStats;
  later: PeriodStats;
  /** True only when both periods are comparable. If not, the rows are shown but should not be read as a trend. */
  comparable: boolean;
  rows: PeriodRow[];
  alpha: number;
  method: string;
};

/**
 * Do deals that entered in the later period reach each stage more or less often than those in the earlier one? Each
 * share is the deals that reached the stage within the window of entering, as a share of the deals that entered, with
 * elapsed time and the closing instant inside. The difference gets an interval from the same Newcombe method as the
 * readout, because the two periods hold different deals. A clear difference is not proof of why it changed.
 */
export async function periodComparison(
  engine: SqlEngine,
  table: string,
  options: { windowDays: number; asOf: string; earlier: Period; later: Period },
  selection: PipelineSelection,
): Promise<PeriodComparison> {
  checkTable(table);
  if (!Number.isFinite(options.windowDays) || options.windowDays <= 0) {
    throw new RangeError("The window must be above 0 days.");
  }
  const asOfMs = Date.parse(options.asOf);
  if (!Number.isFinite(asOfMs)) throw new RangeError("The cutoff is not a time.");
  const checked = (period: Period): { from: number; to: number } => {
    const from = Date.parse(period.from);
    const to = Date.parse(period.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new RangeError("A period needs a start and an end time.");
    if (!(from < to)) throw new RangeError("A period must start before it ends.");
    return { from, to };
  };
  const bounds = { earlier: checked(options.earlier), later: checked(options.later) };
  const windowSeconds = Math.round(options.windowDays * DAY_SECONDS);
  const matureBefore = asOfMs - windowSeconds * 1000;
  const where = pipelineWhere(selection);
  const joiner = where.sql ? `${where.sql} AND` : "WHERE";
  const sqlTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
  const within = (c: string) => `count(*) FILTER (WHERE ${c} IS NOT NULL AND date_diff('second', e1, ${c}) <= ${windowSeconds})`;

  const measure = async (period: Period, b: { from: number; to: number }) => {
    const [row] = (
      await engine.query(
        `SELECT count(*) AS deals, ${within("e2")} AS q, ${within("e3")} AS p, ${within("e4")} AS w, max(e1) AS latest ` +
          `FROM ${table} ${joiner} e1 >= CAST(? AS TIMESTAMP) AND e1 < CAST(? AS TIMESTAMP)`,
        [...where.params, sqlTime(b.from), sqlTime(b.to)],
      )
    ).map(toPlainRow);
    const latestMs = timeOf(row.latest);
    const latest = latestMs === null ? null : new Date(latestMs).toISOString();
    const stats: PeriodStats = {
      from: period.from,
      to: period.to,
      deals: Number(row.deals),
      comparable: latestMs !== null && latestMs <= matureBefore,
      latestEntry: latest,
    };
    return { stats, reached: [Number(row.q), Number(row.p), Number(row.w)] };
  };

  const earlier = await measure(options.earlier, bounds.earlier);
  const later = await measure(options.later, bounds.later);
  const alpha = 0.05;
  const stages = [PIPELINE_STAGES[1], PIPELINE_STAGES[2], PIPELINE_STAGES[3]];
  const rows: PeriodRow[] = stages.map((stage, i) => {
    const e = earlier.reached[i];
    const l = later.reached[i];
    const eShare = earlier.stats.deals === 0 ? 0 : e / earlier.stats.deals;
    const lShare = later.stats.deals === 0 ? 0 : l / later.stats.deals;
    const empty = earlier.stats.deals === 0 || later.stats.deals === 0;
    const interval = empty ? { low: 0, high: 0 } : newcombeDifference(l, later.stats.deals, e, earlier.stats.deals, alpha);
    return {
      stage,
      earlier: { reached: e, share: eShare },
      later: { reached: l, share: lShare },
      difference: empty ? 0 : lShare - eShare,
      interval,
      significant: !empty && (interval.low > 0 || interval.high < 0),
    };
  });
  return {
    windowDays: options.windowDays,
    earlier: earlier.stats,
    later: later.stats,
    comparable: earlier.stats.comparable && later.stats.comparable,
    rows,
    alpha,
    method:
      `Share of the deals that entered in each period that reached the stage within ${options.windowDays} days of entering. ` +
      `period. The difference is the later share minus the earlier share, with a 95 percent Newcombe hybrid score interval. ` +
      `A period counts as comparable only when its newest deal has had the whole window.`,
  };
}

export type OutlookStage = {
  stage: string;
  /** Open deals at this stage that have moved within the threshold. */
  active: number;
  /** Open deals at this stage that have been quiet for at least the threshold. Left out of the expected wins. */
  stalled: number;
  /** Deals that reached this stage and have since been won or lost. */
  resolved: number;
  won: number;
  /** Won over resolved. The chance that a deal that reaches this stage is eventually won. */
  rate: number;
  rateLow: number;
  rateHigh: number;
  /** Active deals times the rate. */
  expected: number;
  /** Active deals times the low and high ends of the interval on the rate. */
  low: number;
  high: number;
};

export type Outlook = {
  thresholdDays: number;
  stages: OutlookStage[];
  totals: {
    active: number;
    stalled: number;
    expected: number;
    low: number;
    high: number;
    /** 95 percent spread from chance alone, with the rates exactly right. Separate from low and high. */
    chanceSpread: number;
  };
};

/**
 * How many of the open deals might be won. For each stage, the chance of winning is learned from the deals that reached
 * it and have since been won or lost, with a Wilson interval, and it is applied to the open deals now at that stage.
 * Open deals quiet for at least `thresholdDays` are left out and counted separately, because a deal that has gone quiet
 * is much less likely to win than the average for its stage. The range reflects not knowing the rate exactly. The chance
 * spread is separate: even with the rate right, each deal either wins or does not. Only the segment and source filters
 * apply, because a stage or status filter would change which deals the rates are learned from. There is no timing, so it
 * says how many, not when.
 */
export async function openDealOutlook(
  engine: SqlEngine,
  table: string,
  selection: PipelineSelection,
  options: { thresholdDays: number; asOf: string },
): Promise<Outlook> {
  checkTable(table);
  if (!Number.isFinite(options.thresholdDays) || options.thresholdDays < 0) {
    throw new RangeError("The stalled threshold must be 0 days or more.");
  }
  const asOfMs = Date.parse(options.asOf);
  if (!Number.isFinite(asOfMs)) throw new RangeError("The cutoff is not a time.");
  const asOf = new Date(asOfMs).toISOString().slice(0, 19).replace("T", " ");
  const where = pipelineWhere({ segment: selection.segment, source: selection.source });
  const t = options.thresholdDays;
  const names = [PIPELINE_STAGES[0], PIPELINE_STAGES[1], PIPELINE_STAGES[2]];
  const reached = ["e1", "e2", "e3"];

  const columns = names.flatMap((name, i) => [
    `count(*) FILTER (WHERE ${reached[i]} IS NOT NULL AND status IN ('won', 'lost')) AS r${i}`,
    `count(*) FILTER (WHERE ${reached[i]} IS NOT NULL AND status = 'won') AS w${i}`,
    `count(*) FILTER (WHERE status = 'open' AND stage = '${name}' AND idle < ${t}) AS a${i}`,
    `count(*) FILTER (WHERE status = 'open' AND stage = '${name}' AND idle >= ${t}) AS s${i}`,
  ]);
  const [row] = (
    await engine.query(
      `SELECT ${columns.join(", ")} FROM (` +
        `SELECT stage, status, e1, e2, e3, date_diff('second', COALESCE(e4, e3, e2, e1), CAST(? AS TIMESTAMP)) / ${DAY_SECONDS}.0 AS idle ` +
        `FROM ${table} ${where.sql})`,
      [asOf, ...where.params],
    )
  ).map(toPlainRow);

  const stages: OutlookStage[] = names.map((stage, i) => {
    const resolved = Number(row[`r${i}`]);
    const won = Number(row[`w${i}`]);
    const active = Number(row[`a${i}`]);
    const stalled = Number(row[`s${i}`]);
    const rate = resolved === 0 ? 0 : won / resolved;
    const ci = resolved === 0 ? { low: 0, high: 0 } : wilsonInterval(won, resolved, 0.05);
    return {
      stage,
      active,
      stalled,
      resolved,
      won,
      rate,
      rateLow: ci.low,
      rateHigh: ci.high,
      expected: active * rate,
      low: active * ci.low,
      high: active * ci.high,
    };
  });
  const sum = (pick: (s: OutlookStage) => number) => stages.reduce((n, s) => n + pick(s), 0);
  const variance = sum((s) => s.active * s.rate * (1 - s.rate));
  return {
    thresholdDays: t,
    stages,
    totals: {
      active: sum((s) => s.active),
      stalled: sum((s) => s.stalled),
      expected: sum((s) => s.expected),
      low: sum((s) => s.low),
      high: sum((s) => s.high),
      chanceSpread: 1.96 * Math.sqrt(variance),
    },
  };
}
