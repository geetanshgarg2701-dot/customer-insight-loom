"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { downloadText } from "@/lib/app/download";
import { formatCount, formatPercent } from "@/lib/app/format";
import { deleteBrowserData, getBrowserLedger, readBrowserUsage } from "@/lib/duckdb/client";
import { RETENTION_MINUTES, leftText } from "@/lib/usage/retention";
import { retentionStore } from "@/lib/usage/retention-store";
import { useRetention } from "@/lib/usage/use-retention";
import { exportNag, lastExportTime, noteExport, WARN_AT, type Usage } from "@/lib/usage/usage";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

const mib = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
const LEVEL_TEXT = {
  ok: "Plenty of room.",
  warn: "Over 80 percent of the memory limit. Clear data you no longer need, or reload the page.",
  full: "At the memory limit. New data may fail to load until you clear some.",
} as const;
const CONFIRM_WORD = "delete";

export default function DataPage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [entries, setEntries] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const [lastExport, setLastExport] = useState<number | null>(lastExportTime());
  const [deletedNotice, setDeletedNotice] = useState(false);
  const [expiredNotice, setExpiredNotice] = useState(false);
  const retention = useRetention();
  const [now, setNow] = useState(0);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setNow(Date.now());
      setUsage(await readBrowserUsage());
      setEntries((await (await getBrowserLedger()).listEntries()).length);
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);

  useEffect(() => {
    // After a delete the page reloads with this marker in its address, so the confirmation survives the reload. It holds no data.
    if (window.location.hash === "#deleted") {
      window.history.replaceState(null, "", window.location.pathname);
      void Promise.resolve().then(() => setDeletedNotice(true));
    }
    if (window.location.hash === "#expired") {
      window.history.replaceState(null, "", window.location.pathname);
      void Promise.resolve().then(() => setExpiredNotice(true));
    }
    void Promise.resolve().then(refresh);
  }, [refresh]);

  async function onExport() {
    setError(null);
    try {
      const file = await (await getBrowserLedger()).exportFile();
      downloadText(`evidence-ledger-${file.exported_at.slice(0, 10)}.json`, "application/json", JSON.stringify(file, null, 2));
      noteExport(Date.now());
      setLastExport(lastExportTime());
      setNow(Date.now());
    } catch (e) {
      setError(messageOf(e));
    }
  }

  async function onDelete() {
    setBusy(true);
    setError(null);
    try {
      await deleteBrowserData();
      // A reload is what clears every open screen's view of the data, and it frees the memory.
      window.location.hash = "#deleted";
      window.location.reload();
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  }

  const nag = now === 0 ? null : exportNag(lastExport, now, entries);
  const rows = usage?.tables.reduce((n, t) => n + t.rows, 0) ?? 0;

  return (
    <main>
      <h1>Your data in this tab</h1>
      <p>
        Everything you load here lives in this browser tab only. Nothing is stored, nothing is sent anywhere, and a page
        reload empties it all. This screen shows what the tab holds, how much memory it uses, and clears it on request.
      </p>
      {deletedNotice && <p role="status">Everything in this tab was deleted, and the page was reloaded.</p>}
      {expiredNotice && (
        <p role="status">
          Everything in this tab was deleted because it was inactive for longer than the time you set, and the page was
          reloaded. The timer is off again.
        </p>
      )}
      {error && <p role="alert">{error}</p>}

      <section aria-labelledby="h-memory">
        <h2 id="h-memory">Memory</h2>
        {usage ? (
          <>
            <p>
              <meter
                min={0}
                max={usage.limitBytes}
                low={usage.limitBytes * WARN_AT}
                high={usage.limitBytes * WARN_AT}
                optimum={0}
                value={Math.min(usage.usedBytes, usage.limitBytes)}
                aria-label="Database memory in use, against its limit"
                style={{ width: "100%" }}
              />
            </p>
            <p role="status">
              {mib(usage.usedBytes)} of {mib(usage.limitBytes)}, {formatPercent(usage.fraction, 1)}. {LEVEL_TEXT[usage.level]}
            </p>
            <p>
              This is the in-browser database&rsquo;s own memory limit, which is the only limit this app can measure. It warns at{" "}
              {formatPercent(WARN_AT, 0)}. Your computer and browser can run short of memory before this limit, so a large
              file can still fail to load.
            </p>
            <p>
              <button type="button" onClick={() => void refresh()}>
                Refresh
              </button>
            </p>
          </>
        ) : (
          !error && <p>Reading the database</p>
        )}
      </section>

      <section aria-labelledby="h-held">
        <h2 id="h-held">What this tab holds</h2>
        {usage && usage.tables.length === 0 && <p>Nothing. No table is loaded.</p>}
        {usage && usage.tables.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table>
              <caption>
                {formatCount(usage.tables.length)} tables, {formatCount(rows)} rows in all
              </caption>
              <thead>
                <tr>
                  <th scope="col">Table</th>
                  <th scope="col">Rows</th>
                </tr>
              </thead>
              <tbody>
                {usage.tables.map((t) => (
                  <tr key={t.name}>
                    <th scope="row">{t.name}</th>
                    <td>{formatCount(t.rows)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p>
          The ledger has {formatCount(entries)} {entries === 1 ? "entry" : "entries"}.
        </p>
        <p>
          The Journeys, Pipeline, Comments and Data intake screens drop their own tables when you leave them. Only the
          ledger stays until the page reloads.
        </p>
      </section>

      <section aria-labelledby="h-export">
        <h2 id="h-export">Keep the ledger</h2>
        <p>
          The ledger is the one thing worth keeping. Export it as a file before you clear the tab, and import the file
          again later on the <Link href="/ledger">Ledger</Link> screen.
        </p>
        {nag && <p role="status">{nag}</p>}
        <p>
          <button type="button" onClick={() => void onExport()}>
            Export the ledger
          </button>
        </p>
      </section>

      <section aria-labelledby="h-retention">
        <h2 id="h-retention">Delete automatically after inactivity</h2>
        <p>
          Off until you turn it on. When it is on, this tab deletes everything it holds after a stretch with no clicks or key
          presses, and warns you for the last minute. It matters most on a computer other people use. It lives in this tab
          only, so a reload turns it off, as a reload already empties the tab.
        </p>
        <p>
          <label>
            Delete after{" "}
            <select
              value={retention.state?.minutes ?? 0}
              onChange={(e) => {
                const minutes = Number(e.target.value);
                if (minutes === 0) retentionStore.stop();
                else retentionStore.start(minutes, Date.now());
              }}
            >
              <option value={0}>Off</option>
              {RETENTION_MINUTES.map((m) => (
                <option key={m} value={m}>
                  {m} minutes without activity
                </option>
              ))}
            </select>
          </label>
        </p>
        {retention.state && (
          <p role="status">
            {retention.status.phase === "off" || retention.status.phase === "expired"
              ? "Starting the timer."
              : `Everything in this tab will be deleted after ${retention.state.minutes} minutes without activity. ${
                  retention.status.secondsLeft > 60 ? `About ${leftText(retention.status.secondsLeft)} left.` : "Under a minute left."
                }`}
          </p>
        )}
        <p>Export the ledger first if you want to keep it. A file you exported stays where you saved it.</p>
      </section>

      <section aria-labelledby="h-delete">
        <h2 id="h-delete">Delete everything in this tab</h2>
        <p>
          Drops every table and view in the in-browser database, which holds the ledger, loaded journeys, pipeline and
          comments, and then reloads the page. It cannot be undone. Files you exported stay where you saved them.
        </p>
        <p>
          <label>
            Type {CONFIRM_WORD} to confirm{" "}
            <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </label>
        </p>
        <p>
          <button type="button" disabled={busy || typed.trim().toLowerCase() !== CONFIRM_WORD} onClick={() => void onDelete()}>
            Delete everything and reload
          </button>
        </p>
      </section>
    </main>
  );
}
