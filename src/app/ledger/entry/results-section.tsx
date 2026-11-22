"use client";

import { useEffect, useMemo, useState } from "react";
import { guessColumn } from "@/lib/app/columns";
import { localZone, zones } from "@/lib/app/zones";
import { describeTimeCounts } from "@/lib/assignment/conversion-time";
import { formatCount, formatPercent, formatPoints, formatSignedPoints } from "@/lib/app/format";
import { explainReadout } from "@/lib/app/explain";
import { Explain } from "../../explain";
import { describeVerdict } from "@/lib/app/verdict";
import { downloadText } from "@/lib/app/download";
import { correctionFor, correctionLine, correctionShort } from "@/lib/ledger/correction";
import { verifyBrowserResults } from "@/lib/duckdb/client";
import type { Verification } from "@/lib/assignment/assign";
import { resultRecord, revenueRecord } from "@/lib/assignment/record";
import { demoResultRows, demoResultsCsv, seedFromId } from "@/lib/demo/synthetic";
import type { Ledger, LedgerEntry, ResultVersion } from "@/lib/ledger/ledger";
import { ReadoutLockedError, assertReadoutOpen, conversionWindowHours } from "@/lib/ledger/window";
import type { ExperimentReadout } from "@/lib/stats/experiment";
import type { RevenueReadout } from "@/lib/stats/revenue";
import { RevenuePanel } from "./revenue-panel";
import { useCsvColumns } from "./use-csv-columns";

type Outcome = { verification: Verification; readout: ExperimentReadout; revenue: RevenueReadout | null; ragged: { few: number; many: number } };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/**
 * A readout compares the treatment group with the control group on the one metric registered before launch, so this
 * screen makes one comparison. If a view that compares several groups is ever added here, this is where the count
 * grows, and correctionFor will refuse until a real correction is run across them.
 */
const COMPARISONS_ON_THIS_SCREEN = 1;

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
  const [chosen, setChosen] = useState<Partial<Record<"email" | "group" | "converted" | "received" | "revenue" | "convertedAt", number>>>({});
  const zoneList = useMemo(() => zones(), []);
  const [zone, setZone] = useState(() => localZone(zoneList));
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<ResultVersion[]>([]);
  const [reason, setReason] = useState("");
  const [, setTick] = useState(0);

  const share = treatmentShareOf(entry);
  const names = csv.headers?.map((h) => h.name);

  // The fixed horizon rule. The screen asks the same check the ledger enforces, with the ledger's clock.
  let lockMessage: string | null = null;
  try {
    assertReadoutOpen(entry, ledger.now());
  } catch (e) {
    lockMessage = e instanceof ReadoutLockedError ? e.message : "Results are locked.";
  }
  const locked = lockMessage !== null;
  const launched = entry.status === "running" || entry.status === "readable";

  // While locked, look at the clock once a second so the section opens by itself when the window closes.
  useEffect(() => {
    if (!locked || !launched) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [locked, launched]);

  // Every recorded version of the result, oldest first.
  useEffect(() => {
    let cancelled = false;
    void ledger.listResults(entry.id).then((list) => {
      if (!cancelled) setVersions(list);
    });
    return () => {
      cancelled = true;
    };
  }, [ledger, entry.id, entry.result, entry.status]);

  // The person's own choices win. Until then columns named like email, group and converted are pre-selected.
  const cols = {
    email: chosen.email ?? (names ? guessColumn(names, /e-?mail/i) : -1),
    group: chosen.group ?? (names ? guessColumn(names, /group|arm/i) : -1),
    converted: chosen.converted ?? (names ? guessColumn(names, /convert/i) : -1),
    // Optional. A column that says whether each person received the email, to show delivery next to the readout.
    received: chosen.received ?? (names ? guessColumn(names, /receiv|deliver/i) : -1),
    // Optional, and never guessed: a revenue column is only used when the person picks one.
    revenue: chosen.revenue ?? -1,
    // Optional, and never guessed either: times are only read when the person picks the column.
    convertedAt: chosen.convertedAt ?? -1,
  };

  const required = [cols.email, cols.group, cols.converted];
  const picked = [
    ...required,
    ...(cols.received >= 0 ? [cols.received] : []),
    ...(cols.revenue >= 0 ? [cols.revenue] : []),
    ...(cols.convertedAt >= 0 ? [cols.convertedAt] : []),
  ];
  const ready = required.every((c) => c >= 0) && new Set(picked).size === picked.length;

  async function onVerify() {
    if (share === null) return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const { rows, skipped } = await csv.read(picked);
      // The optional columns follow the three required ones, in the order picked.
      const at = {
        received: cols.received >= 0 ? picked.indexOf(cols.received) : -1,
        revenue: cols.revenue >= 0 ? picked.indexOf(cols.revenue) : -1,
        convertedAt: cols.convertedAt >= 0 ? picked.indexOf(cols.convertedAt) : -1,
      };
      // The time rules need the launch instant and the window. Without them the column is not used.
      const windowHours = conversionWindowHours(entry.design);
      const time = at.convertedAt >= 0 && entry.launchedAt && windowHours !== null ? { launchedAt: entry.launchedAt, windowHours, timeZone: zone } : undefined;
      const result = await verifyBrowserResults({
        entryId: entry.id,
        rows: rows.map((r) => ({
          email: r[0],
          group: r[1],
          converted: r[2],
          received: at.received >= 0 ? r[at.received] : undefined,
          // A revenue key, even a blank one, says the file has a revenue column.
          ...(at.revenue >= 0 ? { revenue: r[at.revenue] } : {}),
          ...(at.convertedAt >= 0 ? { convertedAt: r[at.convertedAt] } : {}),
        })),
        treatmentShare: share,
        time,
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
      await ledger.recordResult(
        entry.id,
        {
          // Aggregates only. No email, no hash and no row level data.
          result: {
            ...resultRecord(outcome.readout, outcome.verification, ledger.now().toISOString()),
            ...(revenueRecord(outcome.revenue) ? { revenue: revenueRecord(outcome.revenue) } : {}),
          },
          comparisonsCount: COMPARISONS_ON_THIS_SCREEN,
          correctionMethod: correctionFor(entry.entryType, COMPARISONS_ON_THIS_SCREEN),
          // The first result needs no reason. Any later one is a new version and must say why.
          reason: entry.result === null ? undefined : reason,
        },
        "user",
      );
      setReason("");
      await onChange();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDemoResults() {
    const d = entry.design as Partial<Record<"baselineRate" | "minDetectableLift" | "syntheticTrueLift", number>> | null;
    if (!d || typeof d.baselineRate !== "number" || typeof d.minDetectableLift !== "number") return;
    setBusy(true);
    setError(null);
    try {
      const { rows, matched } = await demoResultRows({
        ledger,
        entryId: entry.id,
        baselineRate: d.baselineRate,
        trueLift: typeof d.syntheticTrueLift === "number" ? d.syntheticTrueLift : d.minDetectableLift,
        seed: seedFromId(entry.id),
        pendingShare: 0.02,
      });
      if (matched === 0) {
        setError("No one in this entry came from the demo audience, so there is no demo results file to make.");
        return;
      }
      downloadText(`demo-results-${entry.id}.csv`, "text/csv", demoResultsCsv(rows));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const design = entry.design as Partial<Record<"minDetectableLift" | "syntheticTrueLift", number>> | null;
  const demoLift =
    design && typeof design.syntheticTrueLift === "number"
      ? design.syntheticTrueLift
      : design && typeof design.minDetectableLift === "number"
        ? design.minDetectableLift
        : null;

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
  const verdict = r && r.status === "readable" ? describeVerdict(r.readout) : null;
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

      {launched && locked && (
        <>
          <p role="status">Results are locked.</p>
          <p>{lockMessage}</p>
          <p>The upload opens by itself when the window closes. Nothing is read out and nothing is created before then.</p>
        </>
      )}

      {launched && !locked ? (
        <>
          {entry.status === "running" && demoLift !== null && (
            <p>
              <button type="button" disabled={busy} onClick={() => void onDemoResults()}>
                Download demo results file
              </button>{" "}
              For people from the demo audience only. Synthetic outcomes with a true lift of{" "}
              {formatPoints(demoLift)}, and about 2 percent of windows left open.
            </p>
          )}
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
                <label>
                  Received column, optional{" "}
                  <select
                    value={cols.received}
                    onChange={(e) => setChosen({ ...chosen, received: Number(e.target.value) })}
                  >
                    <option value={-1}>No received column</option>
                    {csv.headers.map((h) => (
                      <option key={h.index} value={h.index}>
                        {h.name || `Column ${h.index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              </p>
              <p>
                A received column says whether each person got the email, yes or no. A blank value means not known.
                It is used only to show how far delivery matches the assignment.
              </p>
              <p>
                <label>
                  Revenue column, optional{" "}
                  <select value={cols.revenue} onChange={(e) => setChosen({ ...chosen, revenue: Number(e.target.value) })}>
                    <option value={-1}>No revenue column</option>
                    {csv.headers.map((h) => (
                      <option key={h.index} value={h.index}>
                        {h.name || `Column ${h.index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              </p>
              <p>
                A revenue column holds what each person spent in the window, as a plain number such as 40.50, with no currency
                sign or thousands separator. Leave it blank for people who did not buy. Revenue per recipient is shown only if
                everyone marked as converted has a value, and it is never worked out as lift times one order value.
              </p>
              <p>
                <label>
                  Converted at column, optional{" "}
                  <select value={cols.convertedAt} onChange={(e) => setChosen({ ...chosen, convertedAt: Number(e.target.value) })}>
                    <option value={-1}>No converted at column</option>
                    {csv.headers.map((h) => (
                      <option key={h.index} value={h.index}>
                        {h.name || `Column ${h.index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              </p>
              {cols.convertedAt >= 0 && (
                <p>
                  <label>
                    Time zone for times with no zone{" "}
                    <select value={zone} onChange={(e) => setZone(e.target.value)}>
                      {zoneList.map((z) => (
                        <option key={z} value={z}>
                          {z}
                        </option>
                      ))}
                    </select>
                  </label>
                </p>
              )}
              <p>
                A converted at column holds when each person converted, such as 2026-03-02 10:15 or 2026-03-02T10:15:00Z. A time
                with no zone is read in the zone above. Someone who converted before launch is left out. Someone who converted after the
                window closed counts as not converted in the window. A time that never happened, or happened twice, because the clocks
                changed is left out, never guessed. Each of these is counted below the readout.
              </p>
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
          {v.time && describeTimeCounts(v.time).map((t) => <p key={t}>{t}</p>)}
          <p>
            Sample ratio check: {r.srm.pass ? "passed" : "failed"}, p {r.srm.pValue.toPrecision(3)}. Method:{" "}
            {r.srm.method}
          </p>
          <p>Readout: {STATUS_TEXT[r.status]}</p>
          <p>{r.message}</p>
          {r.status === "readable" && verdict && (
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
                      {formatCount(r.readout.sampleSizes.treatment)} treatment, {formatCount(r.readout.sampleSizes.control)} control
                    </td>
                  </tr>
                </tbody>
              </table>
              <Explain items={explainReadout(r.readout, r.counts)} />
              <p>{verdict.label}</p>
              <p>{verdict.text}</p>
              {r.delivery && <p>Delivery: {r.delivery.note}</p>}
              {outcome.revenue && <RevenuePanel revenue={outcome.revenue} />}
              <p>Method: {r.readout.method}</p>
              <p>{correctionLine(correctionFor(entry.entryType, COMPARISONS_ON_THIS_SCREEN), COMPARISONS_ON_THIS_SCREEN)}</p>
              <p>
                People were assigned by a hash fixed before launch, so the difference can be read as the effect of
                being assigned to the send, within the interval shown. It is {formatPoints(r.readout.lift)} on a
                base of {formatPercent(r.readout.controlRate)}. This is not the effect of receiving the email. If some
                of the control group was emailed anyway, or some of the treatment group was never delivered, the
                measured lift is smaller than the effect on people who received it, and this screen cannot see that.
              </p>
              {entry.result === null ? (
                <p>
                  <button type="button" disabled={busy} onClick={() => void onRecord()}>
                    Record result in ledger
                  </button>
                </p>
              ) : (
                <>
                  <p>
                    This entry already has a recorded result. A new readout is kept as a new version, and the first
                    result is never replaced.
                  </p>
                  <p>
                    <label>
                      Reason for a new version{" "}
                      <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
                    </label>
                  </p>
                  <p>
                    <button
                      type="button"
                      disabled={busy || reason.trim() === "" || entry.status === "closed"}
                      onClick={() => void onRecord()}
                    >
                      Record a new version
                    </button>
                  </p>
                </>
              )}
            </>
          )}
        </>
      )}

      {versions.length > 0 && (
        <>
          <h3>Result versions</h3>
          <p>Results are append only. Version 1 is the first readout, and a later version never replaces it.</p>
          <table aria-label="Result versions">
            <thead>
              <tr>
                <th>Version</th>
                <th>Recorded at</th>
                <th>Reason</th>
                <th>Lift</th>
                <th>Revenue per recipient</th>
                <th>Correction</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => {
                const lift = (v.result as { lift?: unknown } | null)?.lift;
                const revenue = (v.result as { revenue?: { difference?: unknown } } | null)?.revenue?.difference;
                return (
                  <tr key={v.id}>
                    <td>{v.version}</td>
                    <td>{v.recordedAt}</td>
                    <td>{v.reason}</td>
                    <td>{typeof lift === "number" ? formatSignedPoints(lift) : "not available"}</td>
                    <td>
                      {typeof revenue === "number"
                        ? `${revenue < 0 ? "-" : "+"}$${Math.abs(revenue).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : "not recorded"}
                    </td>
                    <td>{correctionShort(v.correctionMethod, v.comparisonsCount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
