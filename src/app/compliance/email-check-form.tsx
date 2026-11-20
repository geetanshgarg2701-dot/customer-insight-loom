"use client";

import { useEffect, useMemo, useState } from "react";
import { EMPTY_EMAIL, SYNTHETIC_EMAIL } from "@/lib/compliance/example";
import { BULK_PER_DAY, checkEmail, DEFAULT_CAP, type EmailCheck, type EmailCheckInput, type RuleStatus } from "@/lib/compliance/rules";

const EMPTY = EMPTY_EMAIL;
const EXAMPLE = SYNTHETIC_EMAIL;

const STATUS_TEXT: Record<RuleStatus, string> = {
  pass: "Pass",
  fail: "Fail",
  needs: "Needs your answer",
  warn: "Check",
  info: "Note",
  "not-applicable": "Does not apply",
};

const TIER_TEXT = { 1: "Law", 2: "Mailbox provider", policy: "App policy", info: "Note" } as const;

const ATTEST: { key: keyof EmailCheckInput["attest"]; label: string }[] = [
  { key: "subjectHonest", label: "The subject line matches what the email is." },
  { key: "headersHonest", label: "The From name and routing information identify who is sending." },
  { key: "adDisclosed", label: "The email clearly says it is an advertisement." },
  { key: "optOutWorks30Days", label: "The opt out will keep working for at least 30 days after sending." },
  { key: "audienceExcludes", label: "The audience leaves out opted out people, people without consent, and holdout controls." },
  { key: "spfOrDkim", label: "SPF or DKIM is set up for the sending domain." },
  { key: "spfAndDkim", label: "Both SPF and DKIM are set up." },
  { key: "dmarc", label: "DMARC is published, at least p=none, with the From domain aligned." },
];

/** A whole number field. Empty means not known, for the fields that allow it. */
function parseCount(raw: string, allowEmpty: boolean): number | null | undefined {
  if (raw.trim() === "") return allowEmpty ? null : undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/**
 * The email check form and its result, shared by the email check screen and a ledger entry. It reports every change, so
 * the entry can record a pass of exactly the email that is on screen.
 */
export function EmailCheckForm({
  onChange,
  initial,
}: {
  onChange?: (input: EmailCheckInput, result: EmailCheck | null) => void;
  /** Fields to start with, such as a draft's subject and body. */
  initial?: Partial<EmailCheckInput>;
}) {
  const [input, setInput] = useState<EmailCheckInput>({ ...EMPTY, ...initial });
  const [raw, setRaw] = useState({ daily: "0", days: "", spam: "", sends: "1", cap: String(DEFAULT_CAP) });
  const [problem, setProblem] = useState<string | null>(null);

  const result = useMemo(() => {
    try {
      return checkEmail(input);
    } catch {
      return null;
    }
  }, [input]);

  const set = <K extends keyof EmailCheckInput>(key: K, value: EmailCheckInput[K]) => setInput((x) => ({ ...x, [key]: value }));

  function setNumber(field: keyof typeof raw, value: string) {
    setRaw((r) => ({ ...r, [field]: value }));
    const allowEmpty = field === "days" || field === "spam";
    const parsed = field === "spam" ? (value.trim() === "" ? null : Number(value)) : parseCount(value, allowEmpty);
    const bad = parsed === undefined || (typeof parsed === "number" && (!Number.isFinite(parsed) || parsed < 0 || (field === "spam" && parsed > 100) || (field === "cap" && parsed < 1)));
    if (bad) {
      setProblem("Some numbers are not valid. The check uses the last valid values until they are fixed.");
      return;
    }
    setProblem(null);
    const key = { daily: "dailyToGmail", days: "unsubscribeDays", spam: "spamRatePercent", sends: "sendsPerCustomer7Days", cap: "cap" }[field] as keyof EmailCheckInput;
    setInput((x) => ({ ...x, [key]: parsed }));
  }

  function fillExample() {
    setInput(EXAMPLE);
    setRaw({ daily: "12000", days: "1", spam: "0.05", sends: "2", cap: String(DEFAULT_CAP) });
    setProblem(null);
  }

  useEffect(() => {
    onChange?.(input, result);
  }, [input, result, onChange]);

  return (
    <>
      <p>
        <button type="button" onClick={fillExample}>
          Fill with a synthetic example
        </button>{" "}
        <button
          type="button"
          onClick={() => {
            setInput(EMPTY);
            setRaw({ daily: "0", days: "", spam: "", sends: "1", cap: String(DEFAULT_CAP) });
            setProblem(null);
          }}
        >
          Clear
        </button>
      </p>

      <section aria-labelledby="h-email">
        <h2 id="h-email">The email</h2>
        <fieldset>
          <legend>Kind of email</legend>
          <label>
            <input type="radio" name="kind" checked={input.kind === "marketing"} onChange={() => set("kind", "marketing")} /> Marketing
          </label>{" "}
          <label>
            <input type="radio" name="kind" checked={input.kind === "transactional"} onChange={() => set("kind", "transactional")} />{" "}
            Transactional, such as a receipt or a shipping notice
          </label>
        </fieldset>
        <p>
          <label>
            From address <input type="text" value={input.fromAddress} onChange={(e) => set("fromAddress", e.target.value)} />
          </label>
        </p>
        <p>
          <label>
            Subject line <input type="text" value={input.subject} onChange={(e) => set("subject", e.target.value)} style={{ width: "100%" }} />
          </label>
        </p>
        <p>
          <label>
            Body
            <textarea value={input.body} onChange={(e) => set("body", e.target.value)} rows={6} style={{ width: "100%" }} />
          </label>
        </p>
        <p>
          <label>
            List-Unsubscribe header{" "}
            <input type="text" value={input.listUnsubscribe} onChange={(e) => set("listUnsubscribe", e.target.value)} style={{ width: "100%" }} />
          </label>
        </p>
        <p>
          <label>
            List-Unsubscribe-Post header{" "}
            <input type="text" value={input.listUnsubscribePost} onChange={(e) => set("listUnsubscribePost", e.target.value)} />
          </label>
        </p>
      </section>

      <section aria-labelledby="h-sending">
        <h2 id="h-sending">How you send</h2>
        <p>
          <label>
            Messages a day to Gmail accounts{" "}
            <input type="text" inputMode="numeric" value={raw.daily} onChange={(e) => setNumber("daily", e.target.value)} />
          </label>{" "}
          {result && (result.bulk ? `At ${BULK_PER_DAY.toLocaleString("en-US")} or more, the bulk sender rules apply.` : "Below bulk volume.")}
        </p>
        <p>
          <label>
            Days to process an unsubscribe, counting every day{" "}
            <input type="text" inputMode="numeric" value={raw.days} onChange={(e) => setNumber("days", e.target.value)} />
          </label>
        </p>
        <p>
          <label>
            Spam rate in percent, from Postmaster Tools{" "}
            <input type="text" inputMode="decimal" value={raw.spam} onChange={(e) => setNumber("spam", e.target.value)} />
          </label>
        </p>
        <p>
          <label>
            Marketing emails per customer in 7 days, across all journeys{" "}
            <input type="text" inputMode="numeric" value={raw.sends} onChange={(e) => setNumber("sends", e.target.value)} />
          </label>
        </p>
        <p>
          <label>
            Frequency cap, app policy{" "}
            <input type="text" inputMode="numeric" value={raw.cap} onChange={(e) => setNumber("cap", e.target.value)} />
          </label>
        </p>
        <p>
          <label>
            <input type="checkbox" checked={input.euOrCanada} onChange={(e) => set("euOrCanada", e.target.checked)} /> Some
            recipients are in the EU or Canada
          </label>
        </p>
        {problem && <p role="alert">{problem}</p>}
      </section>

      <section aria-labelledby="h-attest">
        <h2 id="h-attest">What only you can confirm</h2>
        <p>The app cannot see your sending tool or your DNS, so these are your statements.</p>
        {ATTEST.map((a) => (
          <p key={a.key}>
            <label>
              <input
                type="checkbox"
                checked={input.attest[a.key]}
                onChange={(e) => setInput((x) => ({ ...x, attest: { ...x.attest, [a.key]: e.target.checked } }))}
              />{" "}
              {a.label}
            </label>
          </p>
        ))}
      </section>

      {result && (
        <section aria-labelledby="h-result">
          <h2 id="h-result">Result</h2>
          <p role="status">
            <strong>{result.approved ? "Approved to send." : `Blocked. ${result.blocking.length} ${result.blocking.length === 1 ? "rule needs" : "rules need"} attention.`}</strong>
          </p>
          <div style={{ overflowX: "auto" }}>
            <table>
              <caption>Each rule, its result and its source</caption>
              <thead>
                <tr>
                  <th scope="col">Rule</th>
                  <th scope="col">Result</th>
                  <th scope="col">What it needs</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.id} data-status={r.status}>
                    <th scope="row">
                      {r.rule}
                      <br />
                      <small>{TIER_TEXT[r.tier]}</small>
                    </th>
                    <td>
                      <strong>{STATUS_TEXT[r.status]}</strong>
                      {result.blocking.includes(r.id) && <small> Blocks sending.</small>}
                      <br />
                      {r.detail}
                    </td>
                    <td>{r.requirement}</td>
                    <td>
                      {r.source}
                      {r.url && (
                        <>
                          <br />
                          <small>{r.url}</small>
                        </>
                      )}
                      <br />
                      <small>Checked {r.checked}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
