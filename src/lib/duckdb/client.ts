import type { AsyncDuckDB } from "@duckdb/duckdb-wasm";
import type { verifyResults } from "../assignment/assign";
import { verifyResultsWhenOpen } from "../assignment/gated";
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
