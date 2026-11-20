"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import type { EmailCheck, EmailCheckInput } from "@/lib/compliance/rules";
import { getBrowserLedger } from "@/lib/duckdb/client";
import { DRAFT_LABEL, MAX_BRAND, MAX_CTA, MAX_OFFER, buildDraft, draftHypothesis, type Draft, type DraftInput, type Segment } from "@/lib/email/draft";
import { PAIN_LABELS, type Pain } from "@/lib/insights/comments";
import { THEME_IDS, THEMES } from "@/lib/insights/evidence";
import { FRAMEWORK_TAGS, type FrameworkTag } from "@/lib/ledger/ledger";
import { EmailCheckForm } from "../compliance/email-check-form";
import { Nav } from "../nav";

const FRAMEWORK_NAMES: Record<FrameworkTag, string> = { PAS: "PAS, problem, agitate, solution", FAB: "FAB, feature, advantage, benefit", AIDA: "AIDA, attention, interest, desire, action" };
const SEGMENTS: { value: Segment | ""; label: string }[] = [
  { value: "", label: "All customers" },
  { value: "new", label: "New customers" },
  { value: "returning", label: "Returning customers" },
  { value: "vip", label: "VIP customers" },
];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

type LogRow = { at: string; framework: FrameworkTag; theme: string; segment: string; subject: string };

export default function DraftsPage() {
  const [framework, setFramework] = useState<FrameworkTag>("PAS");
  const [pain, setPain] = useState<Exclude<Pain, "no_issue">>("shipping_cost");
  const [segment, setSegment] = useState<Segment | "">("");
  const [brand, setBrand] = useState("");
  const [offer, setOffer] = useState("");
  const [cta, setCta] = useState("");
  const [draft, setDraft] = useState<{ draft: Draft; input: DraftInput; n: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [check, setCheck] = useState<{ input: EmailCheckInput; result: EmailCheck | null } | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onCheck = useCallback((input: EmailCheckInput, result: EmailCheck | null) => setCheck({ input, result }), []);

  function onDraft(e: React.FormEvent) {
    e.preventDefault();
    setProblem(null);
    setNotice(null);
    try {
      const input: DraftInput = { framework, pain, segment: segment === "" ? null : segment, brand, offer, callToAction: cta };
      // Built here, inside the try, and not inside the updater below, which runs while the page renders.
      const built = buildDraft(input);
      setDraft((d) => ({ draft: built, input, n: (d?.n ?? 0) + 1 }));
      setCheck(null);
    } catch (err) {
      setProblem(messageOf(err));
    }
  }

  /** Records the approval in the sandbox log. Nothing is sent, and the log holds the subject only, never the body. */
  function onApprove() {
    if (!draft || !check?.result?.approved) return;
    setLog((l) => [
      ...l,
      {
        at: new Date().toISOString(),
        framework: draft.input.framework,
        theme: PAIN_LABELS[draft.input.pain],
        segment: draft.input.segment ?? "all customers",
        subject: check.input.subject,
      },
    ]);
    setNotice("Approved in the sandbox. Nothing was sent, and nothing leaves this tab.");
  }

  async function onLedger() {
    if (!draft) return;
    setError(null);
    try {
      const ledger = await getBrowserLedger();
      const entry = await ledger.createDraft(
        { title: `Email: ${check?.input.subject ?? draft.draft.subject}`.slice(0, 200), hypothesis: draftHypothesis(draft.input), frameworkTag: draft.input.framework, themeId: THEME_IDS[draft.input.pain] },
        "user",
      );
      setNotice(`Made a draft ledger entry. Open it from the Ledger to register it and run the email check there before launch.`);
      void entry;
    } catch (e) {
      setError(messageOf(e));
    }
  }

  return (
    <main>
      <Nav />
      <h1>Email drafts</h1>
      <p>
        Draft a marketing email for a segment and a customer complaint, in a named framework, check it against the email
        rules, and approve it. Nothing is sent. The draft is built from a template and what you type, and the app invents
        no numbers and makes no claims about other customers.
      </p>
      <p>{DRAFT_LABEL}</p>

      <section aria-labelledby="h-brief">
        <h2 id="h-brief">The brief</h2>
        <form onSubmit={onDraft}>
          <p>
            <label>
              Framework{" "}
              <select value={framework} onChange={(e) => setFramework(e.target.value as FrameworkTag)}>
                {FRAMEWORK_TAGS.map((t) => (
                  <option key={t} value={t}>
                    {FRAMEWORK_NAMES[t]}
                  </option>
                ))}
              </select>
            </label>
          </p>
          <p>
            <label>
              Complaint to speak to{" "}
              <select value={pain} onChange={(e) => setPain(e.target.value as Exclude<Pain, "no_issue">)}>
                {THEMES.map((t) => (
                  <option key={t} value={t}>
                    {PAIN_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
          </p>
          <p>
            <label>
              Segment{" "}
              <select value={segment} onChange={(e) => setSegment(e.target.value as Segment | "")}>
                {SEGMENTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </p>
          <p>
            <label>
              Brand name <input type="text" value={brand} maxLength={MAX_BRAND} onChange={(e) => setBrand(e.target.value)} />
            </label>
          </p>
          <p>
            <label>
              The offer, finishing the sentence &ldquo;We now offer&hellip;&rdquo;{" "}
              <input type="text" value={offer} maxLength={MAX_OFFER} onChange={(e) => setOffer(e.target.value)} style={{ width: "100%" }} />
            </label>
          </p>
          <p>
            <label>
              Call to action <input type="text" value={cta} maxLength={MAX_CTA} onChange={(e) => setCta(e.target.value)} />
            </label>
          </p>
          <button type="submit">Make the draft</button>
        </form>
        {problem && <p role="alert">{problem}</p>}
      </section>

      {draft && (
        <section aria-labelledby="h-draft">
          <h2 id="h-draft">The draft, and the email check</h2>
          <p>
            Built in the {draft.input.framework} order: {draft.draft.parts.map((p) => p.label).join(", ")}. Edit the subject and
            body below. The draft has a placeholder where your postal address goes, so it cannot pass the check until you
            put a real address there.
          </p>
          <EmailCheckForm key={draft.n} initial={{ subject: draft.draft.subject, body: draft.draft.body }} onChange={onCheck} />
          <h3>Approve</h3>
          <p>
            Approval needs every rule to pass and every statement ticked. It is recorded in the sandbox log below, and nothing
            is sent.
          </p>
          <p>
            <button type="button" disabled={!check?.result?.approved} onClick={onApprove}>
              Approve in the sandbox
            </button>{" "}
            <button type="button" onClick={() => void onLedger()}>
              Make a draft ledger entry from this
            </button>
          </p>
          {!check?.result?.approved && <p>Blocked: fix the rules marked Fail or Needs your answer above first.</p>}
          {notice && <p role="status">{notice}</p>}
          {error && <p role="alert">{error}</p>}
        </section>
      )}

      <section aria-labelledby="h-log">
        <h2 id="h-log">Sandbox log</h2>
        {log.length === 0 ? (
          <p>No draft has been approved yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table aria-label="Sandbox log">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Framework</th>
                  <th scope="col">Complaint</th>
                  <th scope="col">Segment</th>
                  <th scope="col">Subject</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {log.map((r, i) => (
                  <tr key={`${r.at}-${i}`}>
                    <td>{r.at.slice(0, 19).replace("T", " ")} UTC</td>
                    <td>{r.framework}</td>
                    <td>{r.theme}</td>
                    <td>{r.segment}</td>
                    <td>{r.subject}</td>
                    <td>Approved, not sent</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p>
          The log is held in this tab and holds the subject only, never the body. To send for real, use your own sending tool
          after you launch the test from the <Link href="/ledger">Ledger</Link>.
        </p>
      </section>
    </main>
  );
}
