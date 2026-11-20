"use client";

import { useEffect, useRef, useState } from "react";
import { formatCount } from "@/lib/app/format";
import {
  LIMITS,
  acceptByHand,
  createIngestState,
  dismiss,
  processWebhook,
  signBody,
  type IngestConfig,
  type IngestState,
  type ReviewItem,
  type WebhookResponse,
} from "@/lib/ingest/webhook";
import { Nav } from "../nav";

const STEPS = ["Visit", "Product", "Cart", "Purchase"] as const;
const hex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

type Sent = { label: string; response: WebhookResponse; requests: number };

/** A copy of what the screen shows, taken after each change, so the page renders from state and not from the live object. */
type View = {
  accepted: number;
  duplicates: number;
  bad: number;
  reasons: [string, number][];
  review: ReviewItem[];
  overflow: number;
};
const viewOf = (s: IngestState): View => ({
  accepted: s.accepted.length,
  duplicates: s.duplicates,
  bad: s.unauthenticated.count,
  reasons: Object.entries(s.unauthenticated.reasons),
  review: [...s.review],
  overflow: s.reviewOverflow,
});

const SCENARIOS: { id: string; label: string; hint: string }[] = [
  { id: "good", label: "Send a good event", hint: "Accepted and stored with a keyed hash of the customer, never the email." },
  { id: "again", label: "Send the last good event again", hint: "Stored once. The resend is counted as a duplicate." },
  { id: "tamper", label: "Send with a changed body", hint: "Changed after signing, so the signature fails." },
  { id: "old", label: "Send with an old timestamp", hint: "Signed 6 minutes ago, which is outside the 5 minute window." },
  { id: "big", label: "Send an oversize body", hint: "Over 256 KB, refused before it is read." },
  { id: "many", label: "Send 101 events in one request", hint: "The limit is 100 events a request." },
  { id: "late", label: "Send an event from 40 days ago", hint: "Too late. It goes to the review list, where it can be accepted by hand." },
  { id: "future", label: "Send an event 2 days ahead", hint: "More than 24 hours in the future. Rejected to the review list." },
  { id: "step", label: "Send an unmapped step", hint: "The sender may only use the four mapped steps." },
  { id: "flood", label: "Send 61 requests in a row", hint: "The 61st in a minute gets 429 and a Retry-After header." },
];

export default function IngestPage() {
  const state = useRef<IngestState>(createIngestState());
  const config = useRef<IngestConfig | null>(null);
  const counter = useRef(0);
  const lastGood = useRef<unknown>(null);
  const [view, setView] = useState<View>(() => viewOf(createIngestState()));
  const [ready, setReady] = useState(false);
  const [full, setFull] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // The secrets are made here, in this tab, when the page opens. No secret is in the code, and none leaves the page.
    config.current = { signingSecret: `whsec_${hex(24)}`, identitySecret: hex(32), source: "sandbox-sender", steps: STEPS };
    void Promise.resolve().then(() => setReady(true));
  }, []);

  async function post(
    label: string,
    body: string,
    opts: { tamper?: boolean; ageSeconds?: number; repeat?: number } = {},
  ) {
    const cfg = config.current;
    if (!cfg) return;
    setBusy(true);
    try {
      let response: WebhookResponse | null = null;
      const times = opts.repeat ?? 1;
      for (let i = 0; i < times; i++) {
        const now = new Date();
        const timestamp = String(Math.floor(now.getTime() / 1000) - (opts.ageSeconds ?? 0));
        const signature = await signBody(cfg.signingSecret, timestamp, body);
        response = await processWebhook({ ...cfg, readOnly: full }, state.current, {
          body: opts.tamper ? `${body} ` : body,
          signature,
          timestamp,
          now,
        });
      }
      setSent({ label, response: response!, requests: times });
    } finally {
      setView(viewOf(state.current));
      setBusy(false);
    }
  }

  /** Runs one scenario. Called only from a click, so it may read the refs. */
  async function run(id: string) {
    // A time offset from now, negative for the past, made inside this function so it only runs on a click.
    const at = (ms: number) => new Date(Date.now() + ms).toISOString();
    const event = (over: Record<string, unknown> = {}) => ({
      customer: `demo.person${counter.current++}@example.invalid`,
      step: "Cart",
      occurred_at: at(-60_000),
      ...over,
    });
    const one = (over?: Record<string, unknown>) => JSON.stringify({ events: [event(over)] });
    const good = () => {
      const e = event();
      lastGood.current = e;
      return JSON.stringify({ events: [e] });
    };
    switch (id) {
      case "good":
        return post("a good event", good());
      case "again":
        return post("the last good event again", JSON.stringify({ events: [lastGood.current ?? event()] }));
      case "tamper":
        return post("a body changed after signing", one(), { tamper: true });
      case "old":
        return post("a 6 minute old timestamp", one(), { ageSeconds: 360 });
      case "big":
        return post("an oversize body", JSON.stringify({ events: [event({ external_id: "x".repeat(LIMITS.maxBodyBytes) })] }));
      case "many":
        return post("101 events", JSON.stringify({ events: Array.from({ length: 101 }, () => event()) }));
      case "late":
        return post("an event from 40 days ago", one({ occurred_at: at(-40 * 86_400_000) }));
      case "future":
        return post("an event 2 days ahead", one({ occurred_at: at(2 * 86_400_000) }));
      case "step":
        return post("an unmapped step", one({ step: "Checkout" }));
      case "flood":
        return post("61 requests in a row", good(), { repeat: LIMITS.requestsPerMinute + 1 });
    }
  }

  return (
    <main>
      <Nav />
      <h1>Webhook receiver sandbox</h1>
      <p>
        A webhook lets another tool send events to this app. The receiver is built and tested, but it is not deployed, because
        the free static site cannot receive requests. This sandbox signs requests in your browser with a secret made when the
        page opened, runs them through the real receiver code, and shows what it did. Nothing leaves this tab.
      </p>
      <p>
        The rules: a signed body with a timestamp inside 5 minutes, {LIMITS.requestsPerMinute} requests a minute, 256 KB, up to{" "}
        {LIMITS.maxEventsPerRequest} events a request, events up to {LIMITS.acceptDays} days old and not more than{" "}
        {LIMITS.futureHours} hours ahead. These are starting defaults to tune, not measured limits.
      </p>

      <section aria-labelledby="h-send">
        <h2 id="h-send">Send something</h2>
        <p>
          <label>
            <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} /> Pretend storage is full, so good events are deferred
          </label>
        </p>
        <ul>
          {SCENARIOS.map((sc) => (
            <li key={sc.id}>
              <button type="button" disabled={!ready || busy} onClick={() => void run(sc.id)}>
                {sc.label}
              </button>{" "}
              {sc.hint}
            </li>
          ))}
        </ul>
        {sent && (
          <div role="status">
            <p>
              <strong>{sent.label}</strong>
              {sent.requests > 1 ? `, the last of ${sent.requests} requests` : ""}: status {sent.response.status}.
            </p>
            <p>
              {Object.entries(sent.response.headers)
                .filter(([k]) => k === "Retry-After")
                .map(([k, v]) => `${k}: ${v}. `)}
              {JSON.stringify(sent.response.body)}
            </p>
          </div>
        )}
      </section>

      <section aria-labelledby="h-state">
        <h2 id="h-state">What it holds</h2>
        <p>
          {formatCount(view.accepted)} events accepted, {formatCount(view.duplicates)} duplicates counted,{" "}
          {formatCount(view.bad)} bad requests refused, {formatCount(view.review.length)} on the review list.
        </p>
        {view.bad > 0 && (
          <>
            <p>
              Bad requests are logged as metadata only, never the body, because the sender is not known. Repeats collapse into one counter per reason.
            </p>
            <table aria-label="Refused requests by reason">
              <thead>
                <tr>
                  <th scope="col">Reason</th>
                  <th scope="col">Requests</th>
                </tr>
              </thead>
              <tbody>
                {view.reasons.map(([reason, n]) => (
                  <tr key={reason}>
                    <th scope="row">{reason}</th>
                    <td>{formatCount(n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section aria-labelledby="h-review">
        <h2 id="h-review">Review list</h2>
        <p>Events that were rejected, late, in the future or deferred, each with its reason. Nothing is dropped silently.</p>
        {view.overflow > 0 && <p>{formatCount(view.overflow)} more could not be listed because the list is full.</p>}
        {view.review.length === 0 ? (
          <p>Nothing is waiting.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table aria-label="Review list">
              <thead>
                <tr>
                  <th scope="col">Kind</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Step</th>
                  <th scope="col">Occurred</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {view.review.map((r) => (
                  <tr key={r.id}>
                    <th scope="row">{r.kind.replace("_", " ")}</th>
                    <td>{r.reason}</td>
                    <td>{r.event?.step ?? "not read"}</td>
                    <td>{r.event?.occurredAt.slice(0, 10) ?? "not read"}</td>
                    <td>
                      {r.kind === "too_late" && (
                        <>
                          <button
                            type="button"
                            aria-label={`Accept by hand, review item ${r.id}`}
                            onClick={() => {
                              acceptByHand(state.current, r.id);
                              setView(viewOf(state.current));
                            }}
                          >
                            Accept by hand
                          </button>{" "}
                        </>
                      )}
                      <button
                        type="button"
                        aria-label={`Dismiss review item ${r.id}`}
                        onClick={() => {
                          dismiss(state.current, r.id);
                          setView(viewOf(state.current));
                        }}
                      >
                        Dismiss
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
