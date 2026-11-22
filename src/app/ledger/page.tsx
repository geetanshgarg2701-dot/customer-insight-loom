"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getBrowserLedger, importBrowserLedger, seedBrowserDemo } from "@/lib/duckdb/client";
import { downloadText } from "@/lib/app/download";
import { noteExport } from "@/lib/usage/usage";
import { demoAudienceCsv } from "@/lib/demo/synthetic";
import { familywiseLine } from "@/lib/ledger/familywise";
import { FrameworkSection } from "./framework-section";
import { HypothesisPicker } from "./hypothesis-picker";
import { ledgerTiles } from "@/lib/ledger/tiles";
import { ledgerCsv } from "@/lib/ledger/csv";
import { NO_FILTER, filterEntries, type EntryFilter } from "@/lib/ledger/filter";
import { STATUSES, FRAMEWORK_TAGS, type FrameworkTag, type LedgerEntry } from "@/lib/ledger/ledger";
import { PAIN_LABELS } from "@/lib/insights/comments";
import { THEME_IDS, THEMES } from "@/lib/insights/evidence";

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
  const [theme, setTheme] = useState("");
  const [filter, setFilter] = useState<EntryFilter>(NO_FILTER);

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
      await ledger.createDraft({ title, hypothesis, frameworkTag: tag === "" ? null : tag, themeId: theme === "" ? null : theme }, "user");
      setTitle("");
      setTheme("");
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
      setNotice("Loaded 4 synthetic demo entries.");
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
      noteExport(Date.now());
    } catch (e) {
      setError(messageOf(e));
    }
  }

  async function onExportCsv() {
    setError(null);
    setNotice(null);
    try {
      const ledger = await getBrowserLedger();
      const list = await ledger.listEntries();
      const counts = new Map<string, number>();
      for (const e of list) counts.set(e.id, (await ledger.listResults(e.id)).length);
      downloadText(`evidence-ledger-${ledger.now().toISOString().slice(0, 10)}.csv`, "text/csv", ledgerCsv(list, counts));
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
  const tiles = entries ? ledgerTiles(entries) : null;
  const visible = entries ? filterEntries(entries, filter) : null;
  const filtered = JSON.stringify(filter) !== JSON.stringify(NO_FILTER);

  return (
    <main>
      <h1>Ledger</h1>
      <p>
        Method: the ledger lives in this browser tab, in DuckDB-Wasm. Nothing is uploaded. A page
        reload starts an empty ledger, so export it to keep it.
      </p>

      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      {tiles && tiles.entries > 0 && (
        <dl className="tiles" aria-label="The ledger at a glance">
          <div>
            <dt>Entries</dt>
            <dd>{tiles.entries.toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt>Drafts</dt>
            <dd>{tiles.drafts.toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt>Registered or running</dt>
            <dd>{tiles.underway.toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt>Ready to read or closed</dt>
            <dd>{tiles.finished.toLocaleString("en-US")}</dd>
          </div>
        </dl>
      )}

      <section aria-labelledby="new-entry">
        <h2 id="new-entry">New entry</h2>
        <HypothesisPicker title={title} hypothesis={hypothesis} setTitle={setTitle} setHypothesis={setHypothesis} />
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
          <p>
            <label>
              Theme{" "}
              <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                <option value="">None</option>
                {THEMES.map((p) => (
                  <option key={p} value={THEME_IDS[p]}>
                    {PAIN_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>{" "}
            The customer pain this test answers, from the <Link href="/insights">Comments</Link> screen. It links the
            test into that theme&rsquo;s evidence chain, and it is locked once the entry is registered.
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
              Adds four synthetic entries, each labeled synthetic: one confirmatory with a result, one
              exploratory, one still running that you can read out yourself, and one launched in July 2026 that the
              Journeys screen marks on its timeline.
            </p>
            <p>
              The demo outcomes are set so every visitor sees the planted result: a 4 point lift reads as significant and a
              zero lift reads as not significant. Real tests vary from run to run, and the methods page shows how much.
            </p>
          </>
        )}
        {entries !== null && entries.length > 0 && (
          <fieldset>
            <legend>Show</legend>
            <p>
              <label>
                Status{" "}
                <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value as EntryFilter["status"] })}>
                  <option value="all">All</option>
                  {STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </label>{" "}
              <label>
                Type{" "}
                <select value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value as EntryFilter["type"] })}>
                  <option value="all">All</option>
                  <option value="confirmatory">Confirmatory</option>
                  <option value="exploratory">Exploratory</option>
                  <option value="none">Not set</option>
                </select>
              </label>{" "}
              <label>
                Framework tag{" "}
                <select value={filter.tag} onChange={(e) => setFilter({ ...filter, tag: e.target.value as EntryFilter["tag"] })}>
                  <option value="all">All</option>
                  {FRAMEWORK_TAGS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                  <option value="none">No tag</option>
                </select>
              </label>{" "}
              <label>
                Search{" "}
                <input type="search" value={filter.text} onChange={(e) => setFilter({ ...filter, text: e.target.value })} />
              </label>{" "}
              <button type="button" disabled={!filtered} onClick={() => setFilter(NO_FILTER)}>
                Clear filters
              </button>
            </p>
            <p role="status">
              Showing {visible?.length ?? 0} of {entries.length} {entries.length === 1 ? "entry" : "entries"}.
            </p>
          </fieldset>
        )}
        {entries !== null && entries.length > 0 && visible !== null && visible.length === 0 && (
          <p>No entry matches these filters.</p>
        )}
        {entries !== null && entries.length > 0 && visible !== null && visible.length > 0 && (
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
              {(visible ?? []).map((e) => (
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

      {entries && entries.length > 0 && <FrameworkSection entries={entries} />}

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
          </button>{" "}
          <button type="button" onClick={() => void onExportCsv()}>
            Export as CSV
          </button>
        </p>
        <p>
          The ledger file can be imported again. The CSV is for a spreadsheet, one row per entry with its status and first
          result. It holds no design, no assignment and no address. A spreadsheet will show a quote before any text that
          starts like a formula, which is deliberate protection.
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
