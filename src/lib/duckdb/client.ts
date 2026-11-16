import type { AsyncDuckDB } from "@duckdb/duckdb-wasm";
import { createIntake } from "../intake/intake";
import type { Intake, SqlEngine } from "../intake/types";
import { createLedger, type Ledger, type LedgerOptions } from "../ledger/ledger";
import { selfHostedBundles } from "./bundles";

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
      const bundle = await duckdb.selectBundle(selfHostedBundles());
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
