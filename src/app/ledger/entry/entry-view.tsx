"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { getBrowserLedger } from "@/lib/duckdb/client";
import type { AuditRow, Ledger, LedgerEntry } from "@/lib/ledger/ledger";
import { Nav } from "../../nav";
import { AssignmentSection } from "./assignment-section";
import { DesignSection } from "./design-section";
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
        <Nav />
        <p role="alert">{error}</p>
      </main>
    );
  }
  if (!loaded) {
    return (
      <main>
        <Nav />
        <p>Loading</p>
      </main>
    );
  }

  const { ledger, entry, audit, assigned } = loaded;
  const canLaunch = (entry.status === "draft" || entry.status === "registered") && assigned > 0;

  return (
    <main>
      <Nav />
      <h1>{entry.title}</h1>
      {error && <p role="alert">{error}</p>}
      <p>Status: {entry.status}</p>
      <p>Type: {entry.entryType ? TYPE_LABEL[entry.entryType] : "Not set"}</p>
      <p>Source: {entry.provenance === "imported" ? "Imported, times not verified" : "This browser"}</p>
      <p>Hypothesis: {entry.hypothesis}</p>
      {entry.frameworkTag && <p>Framework tag: {entry.frameworkTag}</p>}

      <DesignSection entry={entry} ledger={ledger} onChange={load} />
      <AssignmentSection entry={entry} ledger={ledger} assignedCount={assigned} onChange={load} />

      <section aria-labelledby="launch-h">
        <h2 id="launch-h">Launch</h2>
        <p>
          Launching a registered entry labels it confirmatory. Launching without registering labels it
          exploratory. Send from your own tool, using the assignment file, then launch here.
        </p>
        {entry.launchedAt ? (
          <p>Launched at {entry.launchedAt}.</p>
        ) : (
          <p>
            <button type="button" disabled={busy || !canLaunch} onClick={() => void onLaunch()}>
              {entry.status === "registered" ? "Mark as launched" : "Launch without registering"}
            </button>
          </p>
        )}
        {!entry.launchedAt && assigned === 0 && <p>Assign the audience first.</p>}
      </section>

      {entry.launchedAt && <ResultsSection entry={entry} ledger={ledger} onChange={load} />}

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
