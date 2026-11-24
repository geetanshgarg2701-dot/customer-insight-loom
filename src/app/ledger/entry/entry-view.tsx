"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { EmailCheck, EmailCheckInput } from "@/lib/compliance/rules";
import { COMPLIANCE_PASSED } from "@/lib/ledger/ledger";
import { EmailCheckForm } from "../../compliance/email-check-form";
import { formatPoints } from "@/lib/app/format";
import { getBrowserLedger } from "@/lib/duckdb/client";
import { readoutOpensAt } from "@/lib/ledger/window";
import type { AuditRow, Ledger, LedgerEntry } from "@/lib/ledger/ledger";
import { PAIN_LABELS } from "@/lib/insights/comments";
import { THEME_IDS, THEMES, themeOf } from "@/lib/insights/evidence";
import { AssignmentSection } from "./assignment-section";
import { DesignSection } from "./design-section";
import { exportDeck } from "../../deck-export";
import { ReadoutFirst } from "./readout-first";
import { ResultsSection } from "./results-section";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

const TYPE_LABEL = { confirmatory: "Confirmatory", exploratory: "Exploratory" } as const;

type Loaded = { ledger: Ledger; entry: LedgerEntry; audit: AuditRow[]; assigned: number };

export function EntryView() {
  const id = useSearchParams().get("id");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      setError("No entry was chosen. Pick one from the ledger.");
      return;
    }
    try {
      const ledger = await getBrowserLedger();
      const entry = await ledger.getEntry(id);
      const audit = await ledger.listAudit(id);
      const assigned = (await ledger.listAssignments(id)).length;
      setLoaded({ ledger, entry, audit, assigned });
      setError(null);
    } catch (e) {
      setError(
        e instanceof RangeError
          ? "This entry is not in the ledger. A page reload empties the ledger, so import your export file."
          : messageOf(e),
      );
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!id) {
        if (!cancelled) setError("No entry was chosen. Pick one from the ledger.");
        return;
      }
      try {
        const ledger = await getBrowserLedger();
        const entry = await ledger.getEntry(id);
        const audit = await ledger.listAudit(id);
        const assigned = (await ledger.listAssignments(id)).length;
        if (!cancelled) setLoaded({ ledger, entry, audit, assigned });
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof RangeError
              ? "This entry is not in the ledger. A page reload empties the ledger, so import your export file."
              : messageOf(e),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function onTheme(themeId: string) {
    if (!loaded) return;
    setBusy(true);
    try {
      await loaded.ledger.update(loaded.entry.id, { themeId: themeId === "" ? null : themeId }, "user");
      await load();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const [email, setEmail] = useState<{ input: EmailCheckInput; result: EmailCheck | null } | null>(null);
  const onEmail = useCallback((input: EmailCheckInput, result: EmailCheck | null) => setEmail({ input, result }), []);

  /** The ledger runs the check again on this exact email, so the pass it records is its own, not the screen's. */
  async function onRecordCheck() {
    if (!loaded || !email) return;
    setBusy(true);
    try {
      await loaded.ledger.recordComplianceCheck(loaded.entry.id, email.input, "user");
      await load();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const [deckNote, setDeckNote] = useState<string | null>(null);
  async function onDeck() {
    if (!loaded) return;
    setBusy(true);
    setDeckNote(null);
    try {
      const name = await exportDeck(loaded.entry);
      setDeckNote(`Saved ${name}. It was built in this browser and nothing was uploaded.`);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function onLaunch() {
    if (!loaded) return;
    setBusy(true);
    try {
      await loaded.ledger.launch(loaded.entry.id, "user");
      await load();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && !loaded) {
    return (
      <main>
        <p role="alert">{error}</p>
      </main>
    );
  }
  if (!loaded) {
    return (
      <main>
        <p>Loading</p>
      </main>
    );
  }

  const { ledger, entry, audit, assigned } = loaded;
  const passedAt = audit.find((a) => a.action === COMPLIANCE_PASSED)?.at ?? null;
  const canLaunch = (entry.status === "draft" || entry.status === "registered") && assigned > 0 && passedAt !== null;

  return (
    <main>
      <h1>{entry.title}</h1>
      {error && <p role="alert">{error}</p>}
      <ReadoutFirst key={`readout-${entry.id}`} entry={entry} ledger={ledger} />
      <p>Status: {entry.status}</p>
      <p>Type: {entry.entryType ? TYPE_LABEL[entry.entryType] : "Not set"}</p>
      <p>
        Source:{" "}
        {[
          entry.synthetic ? "Synthetic demo data" : null,
          entry.provenance === "imported" ? "Imported, times not verified" : entry.synthetic ? null : "This browser",
        ]
          .filter(Boolean)
          .join(", ")}
      </p>
      {typeof (entry.design as { syntheticTrueLift?: unknown } | null)?.syntheticTrueLift === "number" && (
        <p>
          This entry was generated with a true lift of{" "}
          {formatPoints((entry.design as { syntheticTrueLift: number }).syntheticTrueLift)}. A correct readout&apos;s
          interval contains it about 95 times in 100.
        </p>
      )}
      <p>Hypothesis: {entry.hypothesis}</p>
      {entry.frameworkTag && <p>Framework tag: {entry.frameworkTag}</p>}
      {entry.registeredAt !== null ? (
        <p>
          Theme: {themeOf(entry.themeId) ? PAIN_LABELS[themeOf(entry.themeId)!] : entry.themeId ? "An id this app does not know" : "None"}.
          {" "}Locked once registered.
          {themeOf(entry.themeId) && (
            <>
              {" "}
              <Link href="/insights">See its evidence chain</Link>
            </>
          )}
        </p>
      ) : (
        <p>
          <label>
            Theme{" "}
            <select value={entry.themeId ?? ""} disabled={busy} onChange={(e) => void onTheme(e.target.value)}>
              <option value="">None</option>
              {THEMES.map((p) => (
                <option key={p} value={THEME_IDS[p]}>
                  {PAIN_LABELS[p]}
                </option>
              ))}
            </select>
          </label>{" "}
          Saved as soon as you choose. It locks when the entry is registered.
        </p>
      )}

      <DesignSection key={`design-${entry.id}`} entry={entry} ledger={ledger} onChange={load} />
      <AssignmentSection key={`assign-${entry.id}`} entry={entry} ledger={ledger} assignedCount={assigned} onChange={load} />

      <section aria-labelledby="launch-h">
        <h2 id="launch-h">Launch</h2>
        <p>
          Launching a registered entry labels it confirmatory. Launching without registering labels it
          exploratory. Send from your own tool, using the assignment file, then launch here.
        </p>
        {!entry.launchedAt && (entry.status === "draft" || entry.status === "registered") && (
          <div>
            <h3>Email check</h3>
            {passedAt !== null ? (
              <p>The email for this entry passed the email check at {passedAt}. The pass is in the history below.</p>
            ) : (
              <>
                <p>
                  Check the email this entry will send. A pass is recorded in the history, without the email text, and
                  launch stays closed until there is one. The same check is on the{" "}
                  <Link href="/compliance">Email check</Link> screen.
                </p>
                <details>
                  <summary>Run the email check for this entry</summary>
                  <EmailCheckForm onChange={onEmail} />
                </details>
                <p>
                  <button type="button" disabled={busy || !email?.result?.approved} onClick={() => void onRecordCheck()}>
                    Record the pass on this entry
                  </button>
                </p>
              </>
            )}
          </div>
        )}
        {entry.launchedAt ? (
          <p>
            Launched at {entry.launchedAt}.
            {readoutOpensAt(entry) ? ` Results unlock at ${readoutOpensAt(entry)!.toISOString()}.` : ""}
          </p>
        ) : (
          <p>
            <button type="button" disabled={busy || !canLaunch} onClick={() => void onLaunch()}>
              {entry.status === "registered" ? "Mark as launched" : "Launch without registering"}
            </button>
          </p>
        )}
        {!entry.launchedAt && assigned === 0 && <p>Assign the audience first.</p>}
        {!entry.launchedAt && passedAt === null && <p>Pass the email check below first.</p>}
      </section>

      {entry.launchedAt && <ResultsSection key={`results-${entry.id}`} entry={entry} ledger={ledger} onChange={load} />}

      <section aria-labelledby="deck-h">
        <h2 id="deck-h">Decision deck</h2>
        <p>
          A PowerPoint file for this test: the question, the design, the result with a chart, and what to keep in mind.
          Every number comes from this entry.
        </p>
        <p>
          <button type="button" disabled={busy} onClick={() => void onDeck()}>
            Export the decision deck
          </button>
        </p>
        {deckNote && <p role="status">{deckNote}</p>}
      </section>

      <section aria-labelledby="history-h">
        <h2 id="history-h">History</h2>
        <ul>
          {audit.map((a) => (
            <li key={a.id}>
              {a.at} {a.actor} {a.action}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
