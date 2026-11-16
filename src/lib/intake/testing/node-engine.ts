import path from "node:path";
import * as duckdb from "@duckdb/duckdb-wasm/blocking";
import type { SqlEngine } from "../types";

/**
 * Test only. Runs the real DuckDB-Wasm engine inside Node through its blocking
 * build, so Vitest exercises the same SQL engine the browser worker runs.
 * It does not measure browser worker overhead.
 */
let bindingsPromise: Promise<duckdb.DuckDBBindings> | null = null;

function getBindings(): Promise<duckdb.DuckDBBindings> {
  bindingsPromise ??= (async () => {
    const dist = path.join(
      process.cwd(),
      "node_modules",
      "@duckdb",
      "duckdb-wasm",
      "dist",
    );
    const bundles = {
      mvp: { mainModule: path.join(dist, "duckdb-mvp.wasm"), mainWorker: "" },
      eh: { mainModule: path.join(dist, "duckdb-eh.wasm"), mainWorker: "" },
    };
    const bindings = await duckdb.createDuckDB(
      bundles,
      new duckdb.VoidLogger(),
      duckdb.NODE_RUNTIME,
    );
    await bindings.instantiate(() => {});
    bindings.open({});
    return bindings;
  })();
  return bindingsPromise;
}

export async function createNodeEngine(): Promise<SqlEngine> {
  const bindings = await getBindings();
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
    async close() {
      conn.close();
    },
  };
}
