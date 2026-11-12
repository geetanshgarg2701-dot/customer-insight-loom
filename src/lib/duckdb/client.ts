import type { AsyncDuckDB } from "@duckdb/duckdb-wasm";
import { selfHostedBundles } from "./bundles";
import { toPlainRow, type PlainRow } from "./normalize";

let dbPromise: Promise<AsyncDuckDB> | null = null;

/**
 * Starts DuckDB-Wasm once, inside its own Web Worker. Browser only.
 * The package is imported lazily: its Node entry crashes if Next evaluates
 * it during server rendering.
 */
export function getDuckDb(): Promise<AsyncDuckDB> {
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

/** Runs one SQL statement and returns plain rows (no bigint, no Arrow types). */
export async function query(sql: string): Promise<PlainRow[]> {
  const db = await getDuckDb();
  const conn = await db.connect();
  try {
    const table = await conn.query(sql);
    return table.toArray().map((row) => toPlainRow(row.toJSON()));
  } finally {
    await conn.close();
  }
}
