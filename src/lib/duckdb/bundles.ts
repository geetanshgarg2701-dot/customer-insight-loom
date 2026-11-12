export type SelfHostedBundle = { mainModule: string; mainWorker: string };
export type SelfHostedBundles = { mvp: SelfHostedBundle; eh: SelfHostedBundle };

/**
 * DuckDB-Wasm bundles served from this app's own origin, never a CDN.
 * The files are copied into public/duckdb by scripts/copy-duckdb-wasm.mjs.
 */
export function selfHostedBundles(basePath = "/duckdb"): SelfHostedBundles {
  const base = basePath.replace(/\/+$/, "");
  return {
    mvp: {
      mainModule: `${base}/duckdb-mvp.wasm`,
      mainWorker: `${base}/duckdb-browser-mvp.worker.js`,
    },
    eh: {
      mainModule: `${base}/duckdb-eh.wasm`,
      mainWorker: `${base}/duckdb-browser-eh.worker.js`,
    },
  };
}
