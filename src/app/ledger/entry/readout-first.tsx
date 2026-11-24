"use client";

import { useEffect, useState } from "react";
import { formatSignedPoints } from "@/lib/app/format";
import type { Ledger, LedgerEntry, ResultVersion } from "@/lib/ledger/ledger";
import { IntervalPlot } from "../../interval-plot";

/**
 * The newest recorded result, first on the page: the lift, its range, and the range as a picture. It only reads what the ledger
 * already holds. It records nothing, changes no version and adds no wording about what the result means, since the full readout,
 * its checks and its method are in Results below.
 */

type Numbers = { lift: number; low: number; high: number; alpha: number };

function numbersOf(result: unknown): Numbers | null {
  const r = result as { lift?: unknown; interval_low?: unknown; interval_high?: unknown; alpha?: unknown } | null;
  if (!r || typeof r !== "object") return null;
  const { lift, interval_low: low, interval_high: high, alpha } = r;
  return [lift, low, high, alpha].every((v) => typeof v === "number" && Number.isFinite(v))
    ? { lift: lift as number, low: low as number, high: high as number, alpha: alpha as number }
    : null;
}

export function ReadoutFirst({ entry, ledger }: { entry: LedgerEntry; ledger: Ledger }) {
  const [versions, setVersions] = useState<ResultVersion[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void ledger.listResults(entry.id).then((list) => {
      if (!cancelled) setVersions(list);
    });
    return () => {
      cancelled = true;
    };
  }, [ledger, entry.id, entry.result, entry.status]);

  const latest = versions && versions.length > 0 ? versions[versions.length - 1] : null;
  const numbers = numbersOf(latest ? latest.result : entry.result);
  if (!numbers) return null;
  const level = Math.round((1 - numbers.alpha) * 100);
  return (
    <section className="readout-first" aria-labelledby="readout-first-h">
      <h2 id="readout-first-h">Latest readout</h2>
      <p className="readout-lift">
        <span>Lift</span> <strong>{formatSignedPoints(numbers.lift)}</strong>
      </p>
      <p>
        Range, {level} percent interval: {formatSignedPoints(numbers.low)} to {formatSignedPoints(numbers.high)}
      </p>
      <IntervalPlot low={numbers.low} high={numbers.high} lift={numbers.lift} alpha={numbers.alpha} />
      <p>
        {entry.synthetic ? "Synthetic demo data. " : ""}
        {latest && versions ? `Version ${latest.version} of ${versions.length}, recorded ${latest.recordedAt}.` : "The first recorded result."} The full
        readout, its checks and its method are under Results below.
      </p>
    </section>
  );
}
