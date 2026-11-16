"use client";

import { useState } from "react";
import { guessColumn } from "@/lib/app/columns";
import { formatPercent, formatPoints, formatSignedPoints } from "@/lib/app/format";
import { verifyBrowserResults } from "@/lib/duckdb/client";
import type { Verification } from "@/lib/assignment/assign";
import type { Ledger, LedgerEntry } from "@/lib/ledger/ledger";
import type { ExperimentReadout } from "@/lib/stats/experiment";
import { useCsvColumns } from "./use-csv-columns";

type Outcome = { verification: Verification; readout: ExperimentReadout; ragged: { few: number; many: number } };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

const STATUS_TEXT = {
  readable: "readable",
  blocked_srm: "blocked by a data problem",
  waiting: "waiting for conversion windows to close",
} as const;

function treatmentShareOf(entry: LedgerEntry): number | null {
  const d = entry.design as { treatmentShare?: unknown } | null;
  return d && typeof d.treatmentShare === "number" ? d.treatmentShare : null;
}

export function ResultsSection({
  entry,
  ledger,
  onChange,
}: {
  entry: LedgerEntry;
  ledger: Ledger;
  onChange: () => Promise<void>;
}) {
  const csv = useCsvColumns();
  const [chosen, setChosen] = useState<Partial<Record<"email" | "group" | "converted", number>>>({});
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const share = treatmentShareOf(entry);
  const names = csv.headers?.map((h) => h.name);

  // The person's own choices win. Until then columns named like email, group and converted are pre-selected.
  const cols = {
    email: chosen.email ?? (names ? guessColumn(names, /e-?mail/i) : -1),
    group: chosen.group ?? (names ? guessColumn(names, /group|arm/i) : -1),
    converted: chosen.converted ?? (names ? guessColumn(names, /convert/i) : -1),
  };

  const ready = cols.email >= 0 && cols.group >= 0 && cols.converted >= 0 && new Set(Object.values(cols)).size === 3;

  async function onVerify() {
    if (share === null) return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const { rows, skipped } = await csv.read([cols.email, cols.group, cols.converted]);
      const result = await verifyBrowserResults({
        entryId: entry.id,
        rows: rows.map(([email, group, converted]) => ({ email, group, converted })),
        treatmentShare: share,
      });
      setOutcome({ ...result, ragged: { few: skipped.tooFewFields, many: skipped.tooManyFields } });
      await csv.release();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function onRecord() {
    if (!outcome || outcome.readout.status !== "readable") return;
    setBusy(true);
    setError(null);
    try {
      const r = outcome.readout;
      await ledger.recordResult(
        entry.id,
        {
          // Aggregates only. No email, no hash and no row level data.
          result: {
            lift: r.readout.lift,
            interval_low: r.readout.interval.low,
            interval_high: r.readout.interval.high,
            significant: r.readout.significant,
            alpha: r.readout.alpha,
            p_value: r.readout.pValue,
            treatment_rate: r.readout.treatmentRate,
            control_rate: r.readout.controlRate,
            sample_sizes: r.readout.sampleSizes,
            srm_pass: r.srm.pass,
            srm_p_value: r.srm.pValue,
            pending: r.counts.treatment.pending + r.counts.control.pending,
            verification: outcome.verification,
            computed_at: new Date().toISOString(),
            engine_version: r.readout.engineVersion,
            method: r.readout.method,
          },
          comparisonsCount: 1,
          correctionMethod: entry.entryType === "confirmatory" ? "benjamini_hochberg" : "exploratory_label",
        },
        "user",
      );
      await onChange();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function onClose() {
    setBusy(true);
    setError(null);
    try {
      await ledger.close(entry.id, "user");
      await onChange();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const select = (label: string, key: keyof typeof cols) => (
    <p>
      <label>
        {label}{" "}
        <select value={cols[key]} onChange={(e) => setChosen({ ...chosen, [key]: Number(e.target.value) })}>
          <option value={-1}>Choose a column</option>
          {csv.headers!.map((h) => (
            <option key={h.index} value={h.index}>
              {h.name || `Column ${h.index + 1}`}
            </option>
          ))}
        </select>
      </label>
    </p>
  );

  const r = outcome?.readout;
  const v = outcome?.verification;

  return (
    <section aria-labelledby="results-h">
      <h2 id="results-h">Results</h2>
      <p>
        Method: the results file is checked against the stored assignment in this browser. Each email is hashed
        and compared, then dropped. Only the group and the outcome go into the readout.
      </p>
      {error && <p role="alert">{error}</p>}
      {csv.error && <p role="alert">{csv.error}</p>}

      {entry.status === "running" || entry.status === "readable" ? (
        <>
          <p>
            <label>
              Results CSV{" "}
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={csv.busy || busy}
                onChange={(e) => {
                  setOutcome(null);
                  setChosen({});
                  void csv.open(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
          </p>
          {csv.headers && (
            <>
              {select("Email column", "email")}
              {select("Group column", "group")}
              {select("Converted column", "converted")}
              <p>
                A blank converted value means that person&apos;s conversion window is still open. They are excluded and
                counted.
              </p>
              <p>
                <button type="button" disabled={busy || !ready} onClick={() => void onVerify()}>
                  Verify and read out
                </button>
              </p>
            </>
          )}
        </>
      ) : null}

      {v && r && (
        <>
          <table aria-label="Verification">
            <tbody>
              <tr><th scope="row">Rows in the file</th><td>{v.rows}</td></tr>
              <tr><th scope="row">Matched to the assignment</th><td>{v.matched}</td></tr>
              <tr><th scope="row">People never assigned</th><td>{v.unknown}</td></tr>
              <tr><th scope="row">Wrong group</th><td>{v.groupMismatch}</td></tr>
              <tr><th scope="row">Repeated people</th><td>{v.duplicate}</td></tr>
              <tr><th scope="row">Unusable rows</th><td>{v.invalid}</td></tr>
              <tr><th scope="row">Assigned but missing</th><td>{v.missing}</td></tr>
              <tr><th scope="row">Rows skipped for field count</th><td>{outcome.ragged.few + outcome.ragged.many}</td></tr>
            </tbody>
          </table>
          <p>
            Sample ratio check: {r.srm.pass ? "passed" : "failed"}, p {r.srm.pValue.toPrecision(3)}. Method:{" "}
            {r.srm.method}
          </p>
          <p>Readout: {STATUS_TEXT[r.status]}</p>
          <p>{r.message}</p>
          {r.status === "readable" && (
            <>
              <table aria-label="Readout">
                <tbody>
                  <tr><th scope="row">Treatment rate</th><td>{formatPercent(r.readout.treatmentRate)}</td></tr>
                  <tr><th scope="row">Control rate</th><td>{formatPercent(r.readout.controlRate)}</td></tr>
                  <tr><th scope="row">Lift</th><td>{formatSignedPoints(r.readout.lift)}</td></tr>
                  <tr>
                    <th scope="row">{(1 - r.readout.alpha) * 100} percent interval</th>
                    <td>
                      {formatSignedPoints(r.readout.interval.low)} to {formatSignedPoints(r.readout.interval.high)}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">People counted</th>
                    <td>
                      {r.readout.sampleSizes.treatment} treatment, {r.readout.sampleSizes.control} control
                    </td>
                  </tr>
                </tbody>
              </table>
              <p>Significant: {r.readout.significant ? "yes" : "no"}</p>
              <p>Method: {r.readout.method}</p>
              <p>
                People were assigned by a hash fixed before launch, so the difference can be read as an effect of
                the send, within the interval shown. It is {formatPoints(r.readout.lift)} on a base of{" "}
                {formatPercent(r.readout.controlRate)}.
              </p>
              {entry.status === "running" && (
                <p>
                  <button type="button" disabled={busy} onClick={() => void onRecord()}>
                    Record result in ledger
                  </button>
                </p>
              )}
            </>
          )}
        </>
      )}

      {entry.status === "readable" && (
        <p>
          <button type="button" disabled={busy} onClick={() => void onClose()}>
            Close entry
          </button>
        </p>
      )}
    </section>
  );
}
