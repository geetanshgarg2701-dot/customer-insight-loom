"use client";

import { useMemo, useState } from "react";
import { matchIdentities, maskEmail } from "@/lib/identity/identity";
import { checkTimes, columnOf, parseCsv } from "@/lib/app/datacheck";
import type { Explanation } from "@/lib/app/explain";
import { Explain } from "../explain";
import { Nav } from "../nav";

type Source = { name: string; rows: string[][] };

const SHOWN = 8;

function zones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
}

function localZone(list: string[]): string {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return list.includes(z) ? z : "UTC";
  } catch {
    return "UTC";
  }
}

async function readSource(file: File | undefined): Promise<Source | null> {
  if (!file) return null;
  return { name: file.name, rows: parseCsv(await file.text()) };
}

function rowList(rows: number[]): string {
  const head = rows.slice(0, SHOWN).join(", ");
  return rows.length > SHOWN ? `${head}, and ${rows.length - SHOWN} more` : head;
}

export default function CheckPage() {
  const list = useMemo(() => zones(), []);
  const [zone, setZone] = useState(() => localZone(list));
  const [left, setLeft] = useState<Source | null>(null);
  const [right, setRight] = useState<Source | null>(null);
  const [times, setTimes] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(file: File | undefined, set: (s: Source | null) => void) {
    setError(null);
    try {
      set(await readSource(file));
    } catch {
      set(null);
      setError("That file could not be read as text.");
    }
  }

  const leftEmails = left ? columnOf(left.rows, "email") : null;
  const rightEmails = right ? columnOf(right.rows, "email") : null;
  const identity = leftEmails && rightEmails ? matchIdentities({ left: leftEmails, right: rightEmails }) : null;

  const timeColumn = times ? columnOf(times.rows, "time") ?? columnOf(times.rows, "timestamp") : null;
  const timeReport = timeColumn ? checkTimes(timeColumn, zone) : null;

  const idExplain: Explanation[] = identity
    ? [
        {
          label: "Matched",
          value: String(identity.matched.length),
          how: "An address is matched only when the two files hold the same address after trimming, lowercasing and Unicode normalization. Dots and plus tags are never merged, because removing them is a guess.",
        },
        {
          label: "Customers",
          value: String(identity.customers),
          how: `${identity.unmatchedLeft.length} only in the first file, plus ${identity.unmatchedRight.length} only in the second, plus ${identity.matched.length} in both. Repeats inside one file are counted once.`,
        },
        {
          label: "Possible pairs",
          value: String(identity.possiblePairs.length),
          how: "Two unmatched addresses that differ only by a plus tag. They are shown for you to judge and are not merged.",
        },
      ]
    : [];

  const timeExplain: Explanation[] = timeReport
    ? [
        {
          label: "Missing",
          value: String(timeReport.missing.length),
          how: `When clocks jump forward, some local times never happen. In ${zone} a time such as 02:30 on the spring change day does not exist, so it cannot be placed. It is listed, not guessed.`,
        },
        {
          label: "Repeated",
          value: String(timeReport.ambiguous.length),
          how: `When clocks fall back, a local time happens twice. In ${zone} it could be either of two instants an hour apart, so it is listed for you to decide.`,
        },
        {
          label: "Already has a zone",
          value: String(timeReport.withZone),
          how: "A time ending in Z or an offset such as +02:00 names one instant, so the zone setting does not change it.",
        },
      ]
    : [];

  return (
    <main>
      <Nav />
      <h1>Data check</h1>
      <p>
        Two checks you can run before a readout. Nothing is uploaded: files are read in this browser and are gone when
        you close the page. Addresses are shown masked.
      </p>
      {error && <p role="alert">{error}</p>}

      <section aria-labelledby="match-h">
        <h2 id="match-h">Match two files on email</h2>
        <p>Each file needs a column named email.</p>
        <p>
          <label>
            First file <input type="file" accept=".csv,text/csv" onChange={(e) => void load(e.target.files?.[0], setLeft)} />
          </label>
        </p>
        <p>
          <label>
            Second file <input type="file" accept=".csv,text/csv" onChange={(e) => void load(e.target.files?.[0], setRight)} />
          </label>
        </p>
        {left && !leftEmails && <p role="alert">{left.name} has no column named email.</p>}
        {right && !rightEmails && <p role="alert">{right.name} has no column named email.</p>}
        {identity && (
          <div>
            <table>
              <caption>How the two files line up</caption>
              <thead>
                <tr>
                  <th scope="col">Group</th>
                  <th scope="col">People</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>In both files</td><td>{identity.matched.length}</td></tr>
                <tr><td>Only in the first</td><td>{identity.unmatchedLeft.length}</td></tr>
                <tr><td>Only in the second</td><td>{identity.unmatchedRight.length}</td></tr>
                <tr><td>Customers in all</td><td>{identity.customers}</td></tr>
                <tr><td>Repeats dropped (first, second)</td><td>{identity.duplicatesLeft}, {identity.duplicatesRight}</td></tr>
                <tr><td>Not an email (first, second)</td><td>{identity.invalidLeft}, {identity.invalidRight}</td></tr>
              </tbody>
            </table>
            {identity.possiblePairs.length > 0 && (
              <div>
                <h3>Possible pairs, not merged</h3>
                <ul>
                  {identity.possiblePairs.slice(0, SHOWN).map((p) => (
                    <li key={`${p.left}|${p.right}`}>
                      {maskEmail(p.left)} and {maskEmail(p.right)} differ only by a plus tag.
                    </li>
                  ))}
                </ul>
                {identity.possiblePairs.length > SHOWN && <p>And {identity.possiblePairs.length - SHOWN} more.</p>}
              </div>
            )}
            <Explain items={idExplain} />
          </div>
        )}
      </section>

      <section aria-labelledby="time-h">
        <h2 id="time-h">Check times against clock changes</h2>
        <p>The file needs a column named time or timestamp. Row numbers count the rows under the header.</p>
        <p>
          <label>
            Time zone{" "}
            <select value={zone} onChange={(e) => setZone(e.target.value)}>
              {list.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </label>
        </p>
        <p>
          <label>
            File <input type="file" accept=".csv,text/csv" onChange={(e) => void load(e.target.files?.[0], setTimes)} />
          </label>
        </p>
        {times && !timeColumn && <p role="alert">{times.name} has no column named time or timestamp.</p>}
        {timeReport && (
          <div>
            <table>
              <caption>
                {timeReport.total} rows read in {zone}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Result</th>
                  <th scope="col">Rows</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Read as one moment</td><td>{timeReport.ok}</td></tr>
                <tr><td>Already has a zone</td><td>{timeReport.withZone}</td></tr>
                <tr><td>Time that never happened</td><td>{timeReport.missing.length}</td></tr>
                <tr><td>Time that happened twice</td><td>{timeReport.ambiguous.length}</td></tr>
                <tr><td>Not a time</td><td>{timeReport.invalid.length}</td></tr>
                <tr><td>Blank</td><td>{timeReport.blank}</td></tr>
              </tbody>
            </table>
            {timeReport.missing.length > 0 && <p>Never happened, rows: {rowList(timeReport.missing)}.</p>}
            {timeReport.ambiguous.length > 0 && <p>Happened twice, rows: {rowList(timeReport.ambiguous)}.</p>}
            {timeReport.invalid.length > 0 && <p>Not a time, rows: {rowList(timeReport.invalid)}.</p>}
            <Explain items={timeExplain} />
          </div>
        )}
      </section>
    </main>
  );
}
