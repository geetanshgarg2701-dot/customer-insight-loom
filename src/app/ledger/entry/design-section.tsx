"use client";

import { useState } from "react";
import { explainPower } from "@/lib/app/explain";
import { formatCount, formatPercent, formatPoints } from "@/lib/app/format";
import type { Ledger, LedgerEntry } from "@/lib/ledger/ledger";
import { MAX_WINDOW_HOURS, conversionWindowHours } from "@/lib/ledger/window";
import { powerCheck, type PowerResult } from "@/lib/stats/power";

type DesignJson = {
  baselineRate: number;
  minDetectableLift: number;
  treatmentShare: number;
  audienceSize: number;
  conversionWindowHours?: number;
};

function asDesign(v: unknown): DesignJson | null {
  if (typeof v !== "object" || v === null) return null;
  const d = v as Record<string, unknown>;
  return ["baselineRate", "minDetectableLift", "treatmentShare", "audienceSize"].every(
    (k) => typeof d[k] === "number",
  )
    ? (d as unknown as DesignJson)
    : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/** Whole percent text, so 0.07 does not become 7.000000000000001. */
function pctText(proportion: number): string {
  return String(Math.round(proportion * 1e6) / 1e4);
}

export function DesignSection({
  entry,
  ledger,
  onChange,
}: {
  entry: LedgerEntry;
  ledger: Ledger;
  onChange: () => Promise<void>;
}) {
  const stored = asDesign(entry.design);
  const locked = entry.registeredAt !== null;
  const [baseline, setBaseline] = useState(stored ? pctText(stored.baselineRate) : "10");
  const [lift, setLift] = useState(stored ? pctText(stored.minDetectableLift) : "2");
  const [share, setShare] = useState(stored ? pctText(stored.treatmentShare) : "90");
  const [audience, setAudience] = useState(stored ? String(stored.audienceSize) : "10000");
  const [windowHours, setWindowHours] = useState(
    stored?.conversionWindowHours !== undefined ? String(stored.conversionWindowHours) : "168",
  );
  const [power, setPower] = useState<PowerResult | null>(
    locked && entry.powerResult ? (entry.powerResult as PowerResult) : null,
  );
  const [checkedKey, setCheckedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const key = [baseline, lift, share, audience, windowHours].join("|");
  const fresh = locked || (power !== null && checkedKey === key);
  const disabled = locked || busy;

  async function onRun() {
    setBusy(true);
    setError(null);
    try {
      const design: DesignJson = {
        baselineRate: Number(baseline) / 100,
        minDetectableLift: Number(lift) / 100,
        treatmentShare: Number(share) / 100,
        audienceSize: Number(audience),
        conversionWindowHours: Number(windowHours),
      };
      if (conversionWindowHours(design) === null) {
        throw new RangeError(`The conversion window must be more than 0 and at most ${MAX_WINDOW_HOURS} hours.`);
      }
      const result = powerCheck(design);
      await ledger.update(entry.id, { design }, "user");
      setPower(result);
      setCheckedKey(key);
      await onChange();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function onRegister() {
    if (!power) return;
    setBusy(true);
    setError(null);
    try {
      await ledger.register(entry.id, "user", { powerResult: power });
      await onChange();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="design-h">
      <h2 id="design-h">Design and power check</h2>
      {error && <p role="alert">{error}</p>}
      {locked && (
        <p>
          Registered at {entry.registeredAt}. The design is locked, so the hypothesis and design
          cannot be edited after the fact.
        </p>
      )}
      <p>
        <label>
          Baseline conversion rate, percent{" "}
          <input type="number" value={baseline} disabled={disabled} onChange={(e) => setBaseline(e.target.value)} />
        </label>
      </p>
      <p>
        <label>
          Smallest lift to detect, percentage points{" "}
          <input type="number" value={lift} disabled={disabled} onChange={(e) => setLift(e.target.value)} />
        </label>
      </p>
      <p>
        <label>
          Treatment share, percent{" "}
          <input type="number" value={share} disabled={disabled} onChange={(e) => setShare(e.target.value)} />
        </label>
      </p>
      <p>
        <label>
          People available{" "}
          <input type="number" value={audience} disabled={disabled} onChange={(e) => setAudience(e.target.value)} />
        </label>
      </p>
      <p>
        <label>
          Conversion window, hours{" "}
          <input type="number" value={windowHours} disabled={disabled} onChange={(e) => setWindowHours(e.target.value)} />
        </label>{" "}
        Results unlock only after this window closes, so nobody can peek early. 168 hours is 7 days.
      </p>
      {!locked && (
        <p>
          <button type="button" disabled={disabled} onClick={() => void onRun()}>
            Run power check
          </button>
        </p>
      )}

      {power && (
        <>
          <p>{power.pass ? "Power check passed" : "Power check failed"}</p>
          <table aria-label="Power check">
            <tbody>
              <tr>
                <th scope="row">Required per arm</th>
                <td>
                  {formatCount(power.requiredTreatment)} treatment, {formatCount(power.requiredControl)} control
                </td>
              </tr>
              <tr>
                <th scope="row">Available per arm</th>
                <td>
                  {formatCount(power.availableTreatment)} treatment, {formatCount(power.availableControl)} control
                </td>
              </tr>
              {typeof power.smallestDetectableLift === "number" && (
                <tr>
                  <th scope="row">Smallest lift this audience can detect</th>
                  <td>{formatPoints(power.smallestDetectableLift)}</td>
                </tr>
              )}
              <tr>
                <th scope="row">Design</th>
                <td>
                  Baseline {formatPercent(Number(baseline) / 100)}, detect {formatPoints(Number(lift) / 100)}, treatment
                  share {formatPercent(Number(share) / 100, 0)}
                </td>
              </tr>
              <tr>
                <th scope="row">Conversion window</th>
                <td>{windowHours} hours</td>
              </tr>
            </tbody>
          </table>
          {fresh && (
            <details>
              <summary>How these numbers were worked out</summary>
              <dl>
                {explainPower(power, {
                  baselineRate: Number(baseline) / 100,
                  minDetectableLift: Number(lift) / 100,
                  treatmentShare: Number(share) / 100,
                  audienceSize: Number(audience),
                }).map((e) => (
                  <div key={e.label}>
                    <dt>
                      {e.label}: {e.value}
                    </dt>
                    <dd>{e.how}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          {power.pass && typeof power.smallestDetectableLift === "number" && (
            <p>
              Passing means this audience can detect a lift of {formatPoints(Number(lift) / 100)} or more. A real lift
              smaller than {formatPoints(power.smallestDetectableLift)} would usually be missed, and the result would
              read as inconclusive.
            </p>
          )}
          <p>Method: {power.method}</p>
          {!power.pass && (
            <p>
              The audience is smaller than this test needs, so registering is blocked. You can still launch
              without registering. The entry will then be labeled exploratory.
            </p>
          )}
        </>
      )}

      {!locked && (
        <p>
          <button type="button" disabled={busy || !power || !power.pass || !fresh} onClick={() => void onRegister()}>
            Register entry
          </button>
        </p>
      )}
      {!locked && power && !fresh && <p>The numbers changed since the last check. Run the power check again.</p>}
    </section>
  );
}
