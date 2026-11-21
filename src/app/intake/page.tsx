"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserIntake } from "@/lib/duckdb/client";
import { HEALTH_WEIGHTS, type HealthReport } from "@/lib/intake/health";
import { defaultMapping } from "@/lib/intake/mapping";
import type {
  Header,
  Intake,
  LoadResult,
  MappingEntry,
  Preview,
} from "@/lib/intake/types";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

const PART_LABELS = {
  completeness: "Completeness: cells that have a value",
  uniqueness: "Uniqueness: rows that do not repeat",
  validity: "Validity: numbers and dates that parse",
  tidiness: "Tidiness: no stray spaces",
  rowIntegrity: "Row integrity: rows that loaded",
} as const;
const BAND_TEXT = { good: "Good", fair: "Fair, a few things to fix", poor: "Poor, needs cleaning" } as const;
const SEVERITY_TEXT = { high: "Fix first", medium: "Worth fixing", low: "Minor", info: "For your information" } as const;

export default function IntakePage() {
  const intakeRef = useRef<Intake | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<Header[] | null>(null);
  const [mapping, setMapping] = useState<MappingEntry[]>([]);
  const [result, setResult] = useState<LoadResult | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);

  useEffect(() => {
    const holder = intakeRef;
    return () => {
      void holder.current?.close();
      holder.current = null;
    };
  }, []);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setHeaders(null);
    setResult(null);
    setPreview(null);
    setHealth(null);
    setFileName(file.name);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      intakeRef.current ??= await createBrowserIntake();
      const found = await intakeRef.current.open(bytes);
      setHeaders(found);
      setMapping(defaultMapping(found));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function onLoad() {
    const intake = intakeRef.current;
    if (!intake) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setPreview(null);
    setHealth(null);
    try {
      setResult(await intake.load(mapping));
      setPreview(await intake.preview());
      setHealth(await intake.health());
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  function update(index: number, change: Partial<MappingEntry>) {
    setMapping((current) =>
      current.map((m, i) => (i === index ? { ...m, ...change } : m)),
    );
  }

  return (
    <main>
      <h1>Data intake</h1>
      <p>
        Method: the file is read in this browser by DuckDB-Wasm in a Web Worker.
        It is not uploaded anywhere. Columns that look like identity fields, such
        as email, phone, address and person names, cannot be loaded.
      </p>

      <p>
        <label>
          CSV file{" "}
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </p>

      {busy && <p role="status">Working</p>}
      {error && <p role="alert">{error}</p>}

      {headers && (
        <section>
          <h2>Map columns for {fileName}</h2>
          <table aria-label="Column mapping">
            <thead>
              <tr>
                <th>Load</th>
                <th>Column in file</th>
                <th>Name to load as</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {headers.map((h, i) => (
                <tr key={h.index}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Load column ${h.name || h.index + 1}`}
                      checked={mapping[i]?.include ?? false}
                      disabled={h.blocked || busy}
                      onChange={(e) => update(i, { include: e.target.checked })}
                    />
                  </td>
                  <td>{h.name || "No name"}</td>
                  <td>
                    <input
                      type="text"
                      aria-label={`Name for column ${h.name || h.index + 1}`}
                      value={mapping[i]?.target ?? ""}
                      disabled={h.blocked || busy || !mapping[i]?.include}
                      onChange={(e) => update(i, { target: e.target.value })}
                    />
                  </td>
                  <td>
                    {h.blocked ? "Blocked: identity column, cannot be loaded" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            <button type="button" disabled={busy} onClick={() => void onLoad()}>
              Load and preview
            </button>
          </p>
        </section>
      )}

      {result && (
        <section>
          <h2>Result</h2>
          <p>Loaded {result.rowCount} rows.</p>
          {result.skipped.tooFewFields > 0 && (
            <p>
              Skipped {result.skipped.tooFewFields} rows that had fewer fields than
              the header.
            </p>
          )}
          {result.skipped.tooManyFields > 0 && (
            <p>
              Skipped {result.skipped.tooManyFields} rows that had more fields than
              the header.
            </p>
          )}
          {result.skipped.examples.length > 0 && (
            <p>
              First skipped rows, counting the first row after the header as row 1:{" "}
              {result.skipped.examples
                .map(
                  (x) =>
                    `row ${x.row} had ${
                      x.reason === "too_few_fields" ? "too few" : "too many"
                    } fields`,
                )
                .join(", ")}
              .
            </p>
          )}
        </section>
      )}

      {preview && (
        <section>
          <h2>Preview</h2>
          <p>
            Showing {preview.rows.length} of {preview.rowCount} rows. Cells longer
            than 500 characters are clipped here and loaded in full.
          </p>
          <table aria-label="Preview">
            <thead>
              <tr>
                {preview.columns.map((c, i) => (
                  <th key={i}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>{cell ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {health && (
        <section aria-labelledby="h-health">
          <h2 id="h-health">Data health</h2>
          <p role="status">
            <strong>
              {health.score} out of 100, {BAND_TEXT[health.band]}.
            </strong>{" "}
            {health.rows.toLocaleString("en-US")} rows and {health.columns.toLocaleString("en-US")} columns were checked.
          </p>
          <p>{health.caveat}</p>

          {health.findings.length === 0 ? (
            <p>Nothing to clean. No missing values, repeated rows, badly formed numbers or dates, or stray spaces were found.</p>
          ) : (
            <>
              <h3>Cleaning report</h3>
              <ul>
                {health.findings.map((f, i) => (
                  <li key={`${f.id}-${f.column ?? "file"}-${i}`}>
                    <strong>{SEVERITY_TEXT[f.severity]}.</strong> {f.text} {f.fix}
                    {f.examples && f.examples.length > 0 && (
                      <>
                        {" "}
                        First rows to check: {f.examples.join(", ")}, counting the first row after the header as row 1.
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          <details>
            <summary>How the score is made</summary>
            <div style={{ overflowX: "auto" }}>
              <table aria-label="How the score is made">
                <thead>
                  <tr>
                    <th scope="col">Part</th>
                    <th scope="col">Worth</th>
                    <th scope="col">Share earned</th>
                    <th scope="col">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {(Object.keys(HEALTH_WEIGHTS) as (keyof typeof HEALTH_WEIGHTS)[]).map((id) => {
                    const part = health.parts[id];
                    return (
                      <tr key={id}>
                        <th scope="row">{PART_LABELS[id]}</th>
                        <td>{part.scored ? "" : "Not scored. "}{part.weight} points</td>
                        <td>{part.scored ? `${Math.round(part.share * 100)} percent` : "no number or date column"}</td>
                        <td>{part.points.toFixed(1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p>
              The points add up to the score. When a file has no number or date column, validity has nothing to check, so
              its weight is shared among the other parts in proportion, and a clean file still scores 100. Text cells that
              say N/A, null, none or similar are counted as missing. A column counts as numbers or dates when at least 80
              percent of its filled cells look like them. Only year-month-day dates are checked. The report shows column
              names, counts and row numbers, never the values.
            </p>
          </details>
        </section>
      )}
    </main>
  );
}
