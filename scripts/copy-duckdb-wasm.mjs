// Copies the DuckDB-Wasm files into public/duckdb so they are self-hosted.
// Runs on postinstall. The files are large, so public/duckdb is git-ignored.
import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = new URL("../node_modules/@duckdb/duckdb-wasm/dist/", import.meta.url);
const dest = new URL("../public/duckdb/", import.meta.url);
const files = [
  "duckdb-mvp.wasm",
  "duckdb-eh.wasm",
  "duckdb-browser-mvp.worker.js",
  "duckdb-browser-eh.worker.js",
];

mkdirSync(dest, { recursive: true });
for (const f of files) {
  cpSync(fileURLToPath(new URL(f, src)), fileURLToPath(new URL(f, dest)));
}
console.log(`Copied ${files.length} DuckDB-Wasm files to public/duckdb`);
