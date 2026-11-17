"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getBrowserLedger, importBrowserLedger, seedBrowserDemo } from "@/lib/duckdb/client";
import { downloadText } from "@/lib/app/download";
import { demoAudienceCsv } from "@/lib/demo/synthetic";
import { familywiseLine } from "@/lib/ledger/familywise";
import { FRAMEWORK_TAGS, type FrameworkTag, type LedgerEntry } from "@/lib/ledger/ledger";
import { Nav } from "../nav";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

const TYPE_LABEL = { confirmatory: "Confirmatory", exploratory: "Exploratory" } as const;

export default function LedgerPage() {
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [tag, setTag] = useState<"" | FrameworkTag>("");

  const refresh = useCallback(async () => {
    try {
      const ledger = await getBrowserLedger();
      setEntries(await ledger.listEntries());
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await (await getBrowserLedger()).listEntries();
        if (!cancelled) setEntries(list);
      } catch (e) {
        if (!cancelled) setError(messageOf(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onCreate(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const ledger = await getBrowserLedger();
      await ledger.createDraft({ title, hypothesis, frameworkTag: tag === "" ? null : tag }, "user");
      setTitle("");
      setHypothesis("");
      setTag("");
      await refresh();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function onLoadDemo() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await seedBrowserDemo();
      await refresh();
      setNotice("Loaded 3 synthetic demo entries.");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function onExport() {
    setError(null);
    setNotice(null);
    try {
      const file = await (await getBrowserLedger()).exportFile();
      downloadText(
        `evidence-ledger-${file.exported_at.slice(0, 10)}.json`,
        "application/json",
        JSON.stringify(file, null, 2),
      );
    } catch (e) {
      setError(messageOf(e));
    }
  }

  async function onImport(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error("This file is not valid JSON, so it is not a ledger export.");
      }
      await importBrowserLedger(parsed);
      const list = await (await getBrowserLedger()).listEntries();
      setEntries(list);
      setNotice(`Imported ${list.length} ${list.length === 1 ? "entry" : "entries"}.`);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const family = entries ? familywiseLine(entries) : null;

  return (
    <main>
      <Nav />
      <h1>Ledger</h1>
      <p>
        Method: the ledger lives in this browser tab, in DuckDB-Wasm. Nothing is uploaded. A page
        reload starts an empty ledger, so export it to keep it.
      </p>

      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      <section aria-labelledby="new-entry">
        <h2 id="new-entry">New entry</h2>
        <form onSubmit={(e) => void onCreate(e)}>
          <p>
            <label>
              Title <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
          </p>
          <p>
            <label>
              Hypothesis{" "}
              <textarea value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} />
            </label>
          </p>
          <p>
            <label>
              Framework tag{" "}
              <select value={tag} onChange={(e) => setTag(e.target.value as "" | FrameworkTag)}>
                <option value="">None</option>
                {FRAMEWORK_TAGS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </p>
          <button type="submit" disabled={busy}>
            Create draft
          </button>
        </form>
      </section>

      <section aria-labelledby="entries">
        <h2 id="entries">Entries</h2>
        {entries === null && <p>Loading</p>}
        {entries !== null && entries.length === 0 && (
          <>
            <p>No entries yet. Create a draft above, or load the demo.</p>
            <p>
              <button type="button" disabled={busy} onClick={() => void onLoadDemo()}>
                Load demo data
              </button>{" "}
              Adds three synthetic entries, each labeled synthetic: one confirmatory with a result, one
              exploratory, and one still running that you can read out yourself.
            </p>
          </>
        )}
        {entries !== null && entries.length > 0 && (
          <table aria-label="Ledger entries">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Type</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link href={`/ledger/entry?id=${e.id}`}>{e.title}</Link>
                  </td>
                  <td>{e.status}</td>
                  <td>{e.entryType ? TYPE_LABEL[e.entryType] : "Not set"}</td>
                  <td>
                    {[
                      e.synthetic ? "Synthetic demo data" : null,
                      e.provenance === "imported" ? "Imported, times not verified" : e.synthetic ? null : "This browser",
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {family && <p>{family.text}</p>}
      </section>

      <section aria-labelledby="demo">
        <h2 id="demo">Demo audience</h2>
        <p>
          <button
            type="button"
            onClick={() => downloadText("demo-audience.csv", "text/csv", demoAudienceCsv(5000))}
          >
            Download demo audience
          </button>{" "}
          5,000 synthetic people at the reserved example.invalid domain, so no address can reach anyone. Use it
          to try assignment on your own entry. Once launched, the entry page can make a matching demo results
          file.
        </p>
      </section>

      <section aria-labelledby="keep">
        <h2 id="keep">Export and import</h2>
        <p>
          <button type="button" onClick={() => void onExport()}>
            Export ledger
          </button>
        </p>
        <p>
          <label>
            Import ledger file{" "}
            <input
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(e) => {
                void onImport(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        </p>
        <p>
          Import goes into an empty ledger. Times in an imported file are only as trustworthy as the
          file, because anyone can edit a file by hand.
        </p>
      </section>
    </main>
  );
}
