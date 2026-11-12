"use client";

import { useEffect, useState } from "react";
import { query } from "@/lib/duckdb/client";
import type { PlainRow } from "@/lib/duckdb/normalize";

const SQL = "SELECT 6 * 7 AS answer, 'hello' AS greeting";

export default function DuckDbCheck() {
  const [rows, setRows] = useState<PlainRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    query(SQL).then(setRows, (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  return (
    <main className="p-8 font-mono text-sm">
      <h1 className="mb-4 text-lg font-semibold">DuckDB-Wasm check</h1>
      <p className="mb-2">Method: SQL run by DuckDB-Wasm in a Web Worker.</p>
      <pre className="mb-2">{SQL}</pre>
      {rows && <pre data-testid="result">{JSON.stringify(rows)}</pre>}
      {error && <pre data-testid="error">{error}</pre>}
      {!rows && !error && <p>Running</p>}
    </main>
  );
}
