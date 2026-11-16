"use client";

import { useState } from "react";
import { assignAudience, assignmentCsv, type AssignResult } from "@/lib/assignment/assign";
import { guessColumn } from "@/lib/app/columns";
import { downloadText } from "@/lib/app/download";
import type { Ledger, LedgerEntry } from "@/lib/ledger/ledger";
import { useCsvColumns } from "./use-csv-columns";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function treatmentShareOf(entry: LedgerEntry): number | null {
  const d = entry.design as { treatmentShare?: unknown } | null;
  return d && typeof d.treatmentShare === "number" ? d.treatmentShare : null;
}

export function AssignmentSection({
  entry,
  ledger,
  assignedCount,
  onChange,
}: {
  entry: LedgerEntry;
  ledger: Ledger;
  assignedCount: number;
  onChange: () => Promise<void>;
}) {
  const csv = useCsvColumns();
  const [chosen, setChosen] = useState<number | null>(null);
  const [result, setResult] = useState<AssignResult | null>(null);
  const [skipped, setSkipped] = useState<{ tooFewFields: number; tooManyFields: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const share = treatmentShareOf(entry);
  const names = csv.headers?.map((h) => h.name);

  // The person's own choice wins. Until then the column named like an email is pre-selected.
  const emailIndex = chosen ?? (names ? guessColumn(names, /e-?mail/i) : -1);

  async function onAssign() {
    if (share === null) return;
    setBusy(true);
    setError(null);
    try {
      const { rows, skipped: ragged } = await csv.read([emailIndex]);
      const assigned = await assignAudience({
        ledger,
        entryId: entry.id,
        emails: rows.map((r) => r[0]),
        treatmentShare: share,
      });
      setResult(assigned);
      setSkipped(ragged);
      // The raw file is no longer needed once the hashes are stored.
      await csv.release();
      await onChange();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const alreadyAssigned = assignedCount > 0;

  return (
    <section aria-labelledby="assign-h">
      <h2 id="assign-h">Assignment</h2>
      <p>
        Method: each person is placed in a group by a keyed hash of their email, made in this browser. The email
        is read only to make the hash. The app keeps the hash, not the email, and never shows the email.
      </p>
      {share === null && <p>Run the power check first, so the treatment share is saved.</p>}
      {error && <p role="alert">{error}</p>}
      {csv.error && <p role="alert">{csv.error}</p>}

      {share !== null && !alreadyAssigned && !result && (
        <>
          <p>
            <label>
              Audience CSV{" "}
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={csv.busy || busy}
                onChange={(e) => {
                  setChosen(null);
                  void csv.open(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
          </p>
          {csv.headers && (
            <>
              <p>
                <label>
                  Email column{" "}
                  <select value={emailIndex} onChange={(e) => setChosen(Number(e.target.value))}>
                    <option value={-1}>Choose a column</option>
                    {csv.headers.map((h) => (
                      <option key={h.index} value={h.index}>
                        {h.name || `Column ${h.index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              </p>
              {emailIndex < 0 && <p>Choose the column that holds email addresses.</p>}
              <p>
                <button type="button" disabled={busy || emailIndex < 0} onClick={() => void onAssign()}>
                  Assign audience
                </button>
              </p>
            </>
          )}
        </>
      )}

      {result && (
        <>
          <p>
            Assigned {result.assigned} people: {result.treatment} treatment, {result.control} control.
          </p>
          {(result.invalid > 0 || result.duplicates > 0) && (
            <p>
              Left out: {result.invalid} rows without a usable email, {result.duplicates} repeated emails.
            </p>
          )}
          {skipped && (skipped.tooFewFields > 0 || skipped.tooManyFields > 0) && (
            <p>
              Skipped {skipped.tooFewFields} rows with too few fields and {skipped.tooManyFields} rows with too many
              fields.
            </p>
          )}
          <p>
            <button
              type="button"
              onClick={() =>
                downloadText(`assignment-${entry.id}.csv`, "text/csv", assignmentCsv(result.rows, entry.id))
              }
            >
              Download assignment file
            </button>
          </p>
          <p>
            Download the file now and load it into your send tool. The app does not keep emails, so it cannot make
            this file again.
          </p>
        </>
      )}
      {alreadyAssigned && !result && (
        <p>
          {assignedCount} people were assigned earlier. Assignments cannot change. The assignment file is not
          available now, because the app does not keep emails.
        </p>
      )}
    </section>
  );
}
