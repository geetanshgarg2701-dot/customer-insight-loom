import path from "node:path";
import * as duckdb from "@duckdb/duckdb-wasm/blocking";
import type { SqlEngine } from "../types";

/**
 * Test only. Runs the real DuckDB-Wasm engine inside Node through its blocking
 * build, so Vitest exercises the same SQL engine the browser worker runs.
 * It does not measure browser worker overhead.
 */
let shared: Promise<duckdb.DuckDBBindings> | null = null;

async function newBindings(): Promise<duckdb.DuckDBBindings> {
  const dist = path.join(process.cwd(), "node_modules", "@duckdb", "duckdb-wasm", "dist");
  const bundles = {
    mvp: { mainModule: path.join(dist, "duckdb-mvp.wasm"), mainWorker: "" },
    eh: { mainModule: path.join(dist, "duckdb-eh.wasm"), mainWorker: "" },
  };
  const bindings = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
  await bindings.instantiate(() => {});
  bindings.open({});
  return bindings;
}

/**
 * By default every engine shares one in-memory database. Pass isolated to get
 * a database of its own, for tests that need a truly fresh store.
 */
export async function createNodeEngine(options: { isolated?: boolean } = {}): Promise<SqlEngine> {
  const bindings = options.isolated ? await newBindings() : await (shared ??= newBindings());
  const conn = bindings.connect();
  return {
    async registerFile(name, bytes) {
      bindings.registerFileBuffer(name, bytes);
    },
    async dropFile(name) {
      bindings.dropFile(name);
    },
    async exec(sql) {
      conn.query(sql);
    },
    async all(sql) {
      return conn.query(sql).toArray().map((row) => row.toJSON());
    },
    async query(sql, params) {
      const stmt = conn.prepare(sql);
      try {
        return stmt.query(...params).toArray().map((row) => row.toJSON());
      } finally {
        stmt.close();
      }
    },
    async close() {
      conn.close();
    },
  };
}
