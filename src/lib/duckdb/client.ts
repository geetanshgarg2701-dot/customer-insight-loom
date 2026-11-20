import type { AsyncDuckDB } from "@duckdb/duckdb-wasm";
import type { verifyResults } from "../assignment/assign";
import { verifyResultsWhenOpen } from "../assignment/gated";
import { pathCounts, type PathCount } from "../charts/anchored";
import { compareGroups, type CompareDimension, type Comparison } from "../charts/compare";
import { timeInStep, type Timing } from "../charts/timing";
import { behindStep, type BehindStep } from "../charts/behind";
import { exampleJourney, type ExampleJourney } from "../charts/replay";
import { firstEntry, pipelineSeries, stageRecords, type PipelineAt, type StageRecords } from "../charts/pipeline-drill";
import {
  countsBy,
  loadJourneys,
  sankeyEdges,
  topPaths,
  type Count,
  type JourneyDimension,
  type SankeyEdge,
  type Selection,
  type TopPaths,
} from "../charts/crossfilter";
import {
  cohortLadder,
  defaultPeriods,
  dwellHistogram,
  loadPipeline,
  openDealOutlook,
  periodComparison,
  pipelineCounts,
  stageFunnel,
  stalledByStage,
  type CohortRow,
  type Count as PipelineCount,
  type DwellHistogram,
  type FunnelStage,
  type Outlook,
  type PeriodComparison,
  type PipelineDimension,
  type PipelineSelection,
  type Stalled,
} from "../charts/pipeline";
import { JOURNEYS_AS_OF, syntheticJourneys } from "../demo/journeys";
import { createCommentsBoard, type CommentsBoard } from "../insights/board";
import { syntheticComments } from "../insights/comments";
import { loadComments } from "../insights/mentions";
import { prepareComments } from "../insights/prepare";
import { whyAtStep, type Why } from "../insights/why";
import { stepsOverTime, type StepsOverTime } from "../charts/over-time";
import { PIPELINE_AS_OF, syntheticPipeline } from "../demo/pipeline";
import { seedDemoLedger } from "../demo/seed";
import { createIntake } from "../intake/intake";
import type { Intake, SqlEngine } from "../intake/types";
import { importLedger } from "../ledger/export";
import { createLedger, type Ledger, type LedgerOptions } from "../ledger/ledger";
import { duckdbPath, selfHostedBundles } from "./bundles";

let dbPromise: Promise<AsyncDuckDB> | null = null;

/**
 * Starts DuckDB-Wasm once, inside its own Web Worker. Browser only.
 * The package is imported lazily because its Node entry crashes if Next
 * evaluates it during server rendering. Not exported on purpose: callers get
 * the intake and ledger interfaces and cannot run arbitrary SQL.
 */
function getDuckDb(): Promise<AsyncDuckDB> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const duckdb = await import("@duckdb/duckdb-wasm");
      const bundle = await duckdb.selectBundle(selfHostedBundles(duckdbPath(process.env.NEXT_PUBLIC_BASE_PATH)));
      const worker = new Worker(bundle.mainWorker!);
      const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      return db;
    })();
    dbPromise.catch(() => {
      dbPromise = null; // allow a retry after a failed start
    });
  }
  return dbPromise;
}

/** One connection to the shared in-browser database. */
async function createBrowserEngine(): Promise<SqlEngine> {
  const db = await getDuckDb();
  const conn = await db.connect();
  return {
    registerFile: (name, bytes) => db.registerFileBuffer(name, bytes),
    dropFile: async (name) => {
      await db.dropFile(name);
    },
    exec: async (sql) => {
      await conn.query(sql);
    },
    all: async (sql) => {
      const table = await conn.query(sql);
      return table.toArray().map((row) => row.toJSON());
    },
    query: async (sql, params) => {
      const stmt = await conn.prepare(sql);
      try {
        const table = await stmt.query(...params);
        return table.toArray().map((row) => row.toJSON());
      } finally {
        await stmt.close();
      }
    },
    close: () => conn.close(),
  };
}

/** A CSV intake backed by DuckDB-Wasm in a Web Worker. Nothing leaves the browser. */
export async function createBrowserIntake(): Promise<Intake> {
  return createIntake(await createBrowserEngine());
}

/** The demo mode ledger, kept in the same in-browser database. Persisted only by its export file. */
export async function createBrowserLedger(options: LedgerOptions = {}): Promise<Ledger> {
  return createLedger(await createBrowserEngine(), options);
}

let ledgerPromise: Promise<Ledger> | null = null;

/**
 * The one ledger every screen shares. It lives as long as this page does, so
 * moving between screens keeps it and a full page load starts it empty.
 */
export function getBrowserLedger(): Promise<Ledger> {
  if (!ledgerPromise) {
    ledgerPromise = createBrowserLedger();
    ledgerPromise.catch(() => {
      ledgerPromise = null;
    });
  }
  return ledgerPromise;
}

/** Imports an export file into the shared ledger, which must be empty. Throws LedgerImportError otherwise. */
export async function importBrowserLedger(file: unknown): Promise<Ledger> {
  const ledger = await getBrowserLedger();
  const engine = await createBrowserEngine();
  try {
    await importLedger(engine, file, {});
  } finally {
    await engine.close?.();
  }
  return ledger;
}

/** Fills an empty shared ledger with the three synthetic demo entries, plan 6.1. */
export async function seedBrowserDemo(): Promise<void> {
  const ledger = await getBrowserLedger();
  const engine = await createBrowserEngine();
  try {
    await seedDemoLedger({ engine, ledger });
  } finally {
    await engine.close?.();
  }
}

/** Checks an uploaded results file against the stored assignment and reads out the experiment. */
export async function verifyBrowserResults(
  input: Omit<Parameters<typeof verifyResults>[0], "engine" | "ledger">,
): ReturnType<typeof verifyResults> {
  const ledger = await getBrowserLedger();
  const engine = await createBrowserEngine();
  try {
    return await verifyResultsWhenOpen({ ...input, engine, ledger });
  } finally {
    await engine.close?.();
  }
}

/** What the journey screen may ask of its data. Fixed questions only, never arbitrary SQL. */
export type JourneyBoard = {
  rows: number;
  counts(dimension: JourneyDimension, selection: Selection): Promise<Count[]>;
  flow(selection: Selection): Promise<SankeyEdge[]>;
  paths(minShare: number, selection: Selection): Promise<TopPaths>;
  pathCounts(selection: Selection): Promise<PathCount[]>;
  compare(dimension: CompareDimension, a: string, b: string, selection: Selection): Promise<Comparison>;
  timing(windowHours: number, selection: Selection): Promise<Timing>;
  behind(stepIndex: number, selection: Selection): Promise<BehindStep>;
  replay(reached: string, offset: number, selection: Selection): Promise<ExampleJourney>;
  /** Loads the synthetic comments the first time it is asked, then reuses them. */
  why(stepIndex: number, selection: Selection): Promise<Why>;
  /** Each main step by day, for the scrubber and the ledger markers. */
  overTime(selection: Selection): Promise<StepsOverTime>;
  close(): Promise<void>;
};

/** Loads synthetic journeys into the in-browser database for the linked charts. No real data is involved. */
export async function createBrowserJourneyBoard(rows = 100_000, seed = 11): Promise<JourneyBoard> {
  const engine = await createBrowserEngine();
  const table = "journeys";
  const comments = "journey_comments";
  await loadJourneys(engine, table, syntheticJourneys(rows, seed));
  // The comments belong to the first 20,000 customers, the same ones as on the comments screen. A unit test checks that
  // those customers are identical in both sets of journeys. Redaction runs before anything is stored.
  let commentsLoaded: Promise<void> | null = null;
  const ensureComments = () => {
    commentsLoaded ??= (async () => {
      const base = syntheticJourneys(Math.min(rows, 20_000), seed);
      await loadComments(engine, comments, prepareComments(syntheticComments(base, Math.min(3_000, base.length), 17)).rows);
    })();
    return commentsLoaded;
  };
  return {
    rows,
    counts: (dimension, selection) => countsBy(engine, table, dimension, selection),
    flow: (selection) => sankeyEdges(engine, table, selection),
    paths: (minShare, selection) => topPaths(engine, table, selection, { minShare }),
    pathCounts: (selection) => pathCounts(engine, table, selection),
    compare: (dimension, a, b, selection) => compareGroups(engine, table, { dimension, a, b, selection }),
    timing: (windowHours, selection) => timeInStep(engine, table, selection, { asOf: JOURNEYS_AS_OF, windowHours }),
    behind: (stepIndex, selection) => behindStep(engine, table, selection, stepIndex),
    replay: (reached, offset, selection) => exampleJourney(engine, table, selection, { reached, offset }),
    overTime: (selection) => stepsOverTime(engine, table, selection),
    why: async (stepIndex, selection) => {
      await ensureComments();
      return whyAtStep(engine, { comments, journeys: table }, stepIndex, selection);
    },
    close: async () => {
      await engine.exec(`DROP TABLE IF EXISTS ${comments}`);
      await engine.exec(`DROP TABLE IF EXISTS ${table}`);
      await engine.close?.();
    },
  };
}

/** What the pipeline screen may ask of its data. Fixed questions only, never arbitrary SQL. */
export type PipelineBoard = {
  rows: number;
  asOf: string;
  counts(dimension: PipelineDimension, selection: PipelineSelection): Promise<PipelineCount[]>;
  funnel(selection: PipelineSelection): Promise<FunnelStage[]>;
  dwell(stageIndex: number, selection: PipelineSelection): Promise<DwellHistogram>;
  stalled(thresholdDays: number, selection: PipelineSelection): Promise<Stalled[]>;
  cohorts(windowDays: number, selection: PipelineSelection): Promise<CohortRow[]>;
  periods(windowDays: number, selection: PipelineSelection): Promise<PeriodComparison>;
  outlook(thresholdDays: number, selection: PipelineSelection): Promise<Outlook>;
  records(stageIndex: number, which: "reached" | "open", offset: number, selection: PipelineSelection): Promise<StageRecords>;
  series(dates: string[], selection: PipelineSelection): Promise<PipelineAt[]>;
  firstEntry(): Promise<string>;
  close(): Promise<void>;
};

/** Loads a synthetic pipeline into the in-browser database for the pipeline charts. No real data is involved. */
export async function createBrowserPipelineBoard(rows = 100_000, seed = 21): Promise<PipelineBoard> {
  const engine = await createBrowserEngine();
  const table = "pipeline";
  await loadPipeline(engine, table, syntheticPipeline(rows, seed));
  return {
    rows,
    asOf: PIPELINE_AS_OF,
    counts: (dimension, selection) => pipelineCounts(engine, table, dimension, selection),
    funnel: (selection) => stageFunnel(engine, table, selection),
    dwell: (stageIndex, selection) => dwellHistogram(engine, table, stageIndex, selection),
    stalled: (thresholdDays, selection) => stalledByStage(engine, table, { thresholdDays, asOf: PIPELINE_AS_OF }, selection),
    cohorts: (windowDays, selection) => cohortLadder(engine, table, { windowDays, asOf: PIPELINE_AS_OF }, selection),
    outlook: (thresholdDays, selection) => openDealOutlook(engine, table, selection, { thresholdDays, asOf: PIPELINE_AS_OF }),
    periods: (windowDays, selection) =>
      periodComparison(engine, table, { windowDays, asOf: PIPELINE_AS_OF, ...defaultPeriods(PIPELINE_AS_OF, windowDays) }, selection),
    records: (stageIndex, which, offset, selection) =>
      stageRecords(engine, table, selection, { stageIndex, which, offset, limit: 20, asOf: PIPELINE_AS_OF }),
    series: (dates, selection) => pipelineSeries(engine, table, selection, dates),
    firstEntry: () => firstEntry(engine, table),
    close: async () => {
      await engine.exec(`DROP TABLE IF EXISTS ${table}`);
      await engine.close?.();
    },
  };
}

/** Loads synthetic customers and their synthetic comments for the comments screen. Text is redacted before it is stored. */
export async function createBrowserCommentsBoard(customers = 20_000, count = 3_000, seed = 17): Promise<CommentsBoard> {
  const engine = await createBrowserEngine();
  const journeys = syntheticJourneys(customers, 11);
  return createCommentsBoard(engine, journeys, syntheticComments(journeys, count, seed));
}
