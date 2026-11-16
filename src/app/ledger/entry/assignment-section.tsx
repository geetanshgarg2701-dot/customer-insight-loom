"use client";

import { useState } from "react";
import { assignAudience, assignmentCsv, type AssignedRow } from "@/lib/assignment/assign";
import { rebuildAssignment } from "@/lib/assignment/rebuild";
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

/** What the screen shows after assigning or rebuilding. Rows stay in memory for the download only. */
type Outcome =
  | { kind: "assigned"; rows: AssignedRow[]; assigned: number; treatment: number; control: number; duplicates: number; invalid: number }
  | {
      kind: "rebuilt";
      rows: AssignedRow[];
      matched: number;
      unknown: number;
      missing: number;
      duplicates: number;
      invalid: number;
      inconsistent: number;
    };

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
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [skipped, setSkipped] = useState<{ tooFewFields: number; tooManyFields: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const share = treatmentShareOf(entry);
  const names = csv.headers?.map((h) => h.name);
  const alreadyAssigned = assignedCount > 0;

  // The person's own choice wins. Until then the column named like an email is pre-selected.
  const emailIndex = chosen ?? (names ? guessColumn(names, /e-?mail/i) : -1);

  async function onRun() {
    if (share === null) return;
    setBusy(true);
    setError(null);
    try {
      const { rows, skipped: ragged } = await csv.read([emailIndex]);
      const emails = rows.map((r) => r[0]);
      if (alreadyAssigned) {
        const r = await rebuildAssignment({ ledger, entryId: entry.id, emails, treatmentShare: share });
        setOutcome({ kind: "rebuilt", ...r });
      } else {
        const r = await assignAudience({ ledger, entryId: entry.id, emails, treatmentShare: share });
        setOutcome({ kind: "assigned", ...r });
      }
      setSkipped(ragged);
      // The raw file is no longer needed once the hashes are stored or checked.
      await csv.release();
      await onChange();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

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

      {alreadyAssigned && !outcome && (
        <p>
          {assignedCount} people were assigned earlier. Assignments cannot change. To get the assignment file
          again, upload the same audience file. Each group is taken from the stored assignment, never drawn
          again.
        </p>
      )}

      {share !== null && !outcome && (
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
                <button type="button" disabled={busy || emailIndex < 0} onClick={() => void onRun()}>
                  {alreadyAssigned ? "Rebuild assignment file" : "Assign audience"}
                </button>
              </p>
            </>
          )}
        </>
      )}

      {outcome?.kind === "assigned" && (
        <>
          <p>
            Assigned {outcome.assigned} people: {outcome.treatment} treatment, {outcome.control} control.
          </p>
          {(outcome.invalid > 0 || outcome.duplicates > 0) && (
            <p>
              Left out: {outcome.invalid} rows without a usable email, {outcome.duplicates} repeated emails.
            </p>
          )}
        </>
      )}

      {outcome?.kind === "rebuilt" && (
        <>
          <p>
            Rebuilt the file for {outcome.matched} of {assignedCount} assigned people.
          </p>
          {(outcome.unknown > 0 || outcome.missing > 0 || outcome.duplicates > 0 || outcome.invalid > 0 || outcome.inconsistent > 0) && (
            <p>
              Left out: {outcome.unknown} people who were never assigned to this entry, {outcome.duplicates} repeated
              emails, {outcome.invalid} rows without a usable email, and {outcome.inconsistent} people whose stored
              group the hash no longer reproduces. Not in this file: {outcome.missing} assigned people.
            </p>
          )}
        </>
      )}

      {skipped && (skipped.tooFewFields > 0 || skipped.tooManyFields > 0) && (
        <p>
          Skipped {skipped.tooFewFields} rows with too few fields and {skipped.tooManyFields} rows with too many
          fields.
        </p>
      )}

      {outcome && (
        <>
          <p>
            <button
              type="button"
              onClick={() =>
                downloadText(`assignment-${entry.id}.csv`, "text/csv", assignmentCsv(outcome.rows, entry.id))
              }
            >
              Download assignment file
            </button>
          </p>
          <p>
            Load the file into your send tool. The app does not keep emails. If you lose the file, upload the same
            audience file here again to rebuild it.
          </p>
        </>
      )}
    </section>
  );
}
