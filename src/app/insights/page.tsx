"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { formatCount, formatPercent } from "@/lib/app/format";
import { explainMentions } from "@/lib/app/explain-views";
import { createBrowserCommentsBoard, getBrowserLedger } from "@/lib/duckdb/client";
import { assembleChain, CARRIER_SHARE, THEMES, type Carrier, type ChainEntry, type DropLinks, type RankRow } from "@/lib/insights/evidence";
import { QUOTE_PAGE, type CommentsBoard, type QuotePage } from "@/lib/insights/board";
import { PAIN_LABELS, PAINS, type Pain } from "@/lib/insights/comments";
import type { MentionDimension, MentionRates } from "@/lib/insights/mentions";
import type { Scorecard } from "@/lib/insights/prepare";
import { Explain } from "../explain";
import { Nav } from "../nav";

const GROUPINGS: { value: MentionDimension; label: string }[] = [
  { value: "reached", label: "Furthest step reached" },
  { value: "segment", label: "Segment" },
  { value: "channel", label: "Channel" },
  { value: "support", label: "Contacted Support" },
];

const KIND_LABELS = { email: "Emails", phone: "Phone numbers", card: "Card numbers", address: "Street addresses", name: "Personal names" } as const;
const KINDS = ["email", "phone", "card", "address", "name"] as const;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export default function InsightsPage() {
  const board = useRef<CommentsBoard | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [summary, setSummary] = useState<{ kept: number; withheld: number; card: Scorecard } | null>(null);
  const [grouping, setGrouping] = useState<MentionDimension>("reached");
  const [rates, setRates] = useState<MentionRates | null>(null);
  const [pain, setPain] = useState<Pain>("shipping_cost");
  const [page, setPage] = useState<QuotePage | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [ranking, setRanking] = useState<RankRow[] | null>(null);
  const [drops, setDrops] = useState<DropLinks | null>(null);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [entries, setEntries] = useState<ChainEntry[]>([]);
  const [chainPain, setChainPain] = useState<Pain>("shipping_cost");

  async function showRates(dim: MentionDimension) {
    if (!board.current) return;
    setRates(await board.current.mentions(dim));
  }

  async function showQuotes(p: Pain, offset: number) {
    if (!board.current) return;
    setPage(await board.current.quotes(p, offset));
    setEditing(null);
  }

  async function onLoad() {
    setBusy(true);
    setError(null);
    try {
      const b = await createBrowserCommentsBoard();
      board.current = b;
      setSummary({ kept: b.kept, withheld: b.withheld, card: b.scorecard });
      setLoaded(true);
      await showRates(grouping);
      await showQuotes(pain, 0);
      setRanking(await b.ranking());
      setDrops(await b.drops());
      setCarriers(await b.carriers());
      // Ledger entries that name a theme. The ledger lives in this browser only, and an empty one simply has none.
      try {
        const ledger = await getBrowserLedger();
        setEntries((await ledger.listEntries()).map((x) => ({ id: x.id, title: x.title, themeId: x.themeId, status: x.status })));
      } catch {
        setEntries([]);
      }
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function onSave(customer: number) {
    if (!board.current || !page) return;
    setError(null);
    try {
      const result = await board.current.correct(customer, draft);
      setSaved(
        result.removed === 0
          ? "Saved. The edited text was redacted again and nothing needed removing."
          : `Saved. The edited text was redacted again and ${result.removed} ${result.removed === 1 ? "detail was" : "details were"} removed.`,
      );
      await showQuotes(pain, page.offset);
    } catch (e) {
      setError(messageOf(e));
    }
  }

  useEffect(() => {
    return () => {
      void board.current?.close();
    };
  }, []);

  const card = summary?.card;
  const chain = useMemo(
    () => (ranking && drops ? assembleChain(chainPain, ranking, drops, carriers, entries) : null),
    [chainPain, ranking, drops, carriers, entries],
  );
  const shownGroups = rates?.groups.filter((g) => !g.tooSmall) ?? [];
  const hiddenGroups = rates?.groups.filter((g) => g.tooSmall) ?? [];

  return (
    <main>
      <Nav />
      <h1>Customer comments</h1>
      <p>
        What customers say, read next to what they did. Every comment here is synthetic and belongs to one synthetic
        customer, so each one can be joined to that customer&rsquo;s journey. Text is redacted before it is stored or
        shown, and comments without consent are left out.
      </p>
      <p>
        <strong>Names are not removed.</strong> The redaction rules catch emails, phone numbers, card numbers, street
        addresses, social security numbers and IP addresses. They do not catch personal names, and the scorecard below
        shows how many names got through.
      </p>

      {!loaded && (
        <p>
          <button type="button" onClick={() => void onLoad()} disabled={busy}>
            {busy ? "Loading" : "Load synthetic comments"}
          </button>
        </p>
      )}
      {error && <p role="alert">{error}</p>}

      {loaded && card && summary && (
        <>
          <section aria-labelledby="h-redaction">
            <h2 id="h-redaction">Redaction scorecard</h2>
            <p>
              The synthetic comments have fake personal details planted in them on purpose, so redaction can be
              checked against a known total. {formatCount(summary.kept)} comments were kept and{" "}
              {formatCount(summary.withheld)} were withheld because the customer did not give consent. Every
              comment was redacted, kept or not, so the scorecard covers all of them.
            </p>
            <table>
              <caption>Planted details against what redaction caught</caption>
              <thead>
                <tr>
                  <th scope="col">Detail</th>
                  <th scope="col">Planted</th>
                  <th scope="col">Caught</th>
                  <th scope="col">Missed</th>
                </tr>
              </thead>
              <tbody>
                {KINDS.map((k) => (
                  <tr key={k}>
                    <th scope="row">{KIND_LABELS[k]}</th>
                    <td>{formatCount(card[k].planted)}</td>
                    <td>{card[k].coveredByRules ? formatCount(card[k].caught) : "Not covered by the rules"}</td>
                    <td>{formatCount(card[k].missed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {card.name.missed > 0 && (
              <p>
                {formatCount(card.name.missed)} planted names are still in the stored text. Read quotes with that in
                mind, and do not load real comments that hold names until name redaction exists.
              </p>
            )}
          </section>

          <section aria-labelledby="h-mentions">
            <h2 id="h-mentions">How often each pain is mentioned</h2>
            <p>
              Each comment has one coded pain. The share is comments that mention it out of all comments in the group,
              with a 95 percent range. A higher share in one group is an association, not a cause.
            </p>
            <p>
              <label>
                Group by{" "}
                <select
                  value={grouping}
                  onChange={(e) => {
                    const dim = e.target.value as MentionDimension;
                    setGrouping(dim);
                    void showRates(dim).catch((err: unknown) => setError(messageOf(err)));
                  }}
                >
                  {GROUPINGS.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </label>
            </p>
            {rates && (
              <>
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <caption>Share of comments mentioning each pain, by {GROUPINGS.find((g) => g.value === rates.dimension)?.label.toLowerCase()}</caption>
                    <thead>
                      <tr>
                        <th scope="col">Pain</th>
                        <th scope="col">All comments, {formatCount(rates.overall.comments)}</th>
                        {shownGroups.map((g) => (
                          <th scope="col" key={g.value}>
                            {g.value}, {formatCount(g.comments)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {PAINS.map((p, i) => (
                        <tr key={p}>
                          <th scope="row">{PAIN_LABELS[p]}</th>
                          {[rates.overall, ...shownGroups].map((g) => {
                            const r = g.pains[i];
                            return (
                              <td key={g.value}>
                                {formatPercent(r.rate, 1)}
                                <br />
                                <small>
                                  {formatPercent(r.low, 1)} to {formatPercent(r.high, 1)}
                                </small>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {hiddenGroups.length > 0 && (
                  <p>Hidden because each has fewer than 30 comments: {hiddenGroups.map((g) => g.value).join(", ")}.</p>
                )}
                <Explain summary="How the shares were worked out" items={explainMentions(rates)} />
              </>
            )}
          </section>

          <section aria-labelledby="h-ranking">
            <h2 id="h-ranking">Pains ranked</h2>
            <p>
              Mentions are counted in the database. Revenue is the summed synthetic revenue of the customers who raised
              each pain, over the whole demo period. It goes with the pain. It is not caused by it, and only a ledger
              test with a holdout could say more.
            </p>
            {ranking && (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <caption>Pains by number of mentions</caption>
                  <thead>
                    <tr>
                      <th scope="col">Pain</th>
                      <th scope="col">Mentions</th>
                      <th scope="col">Rated severe</th>
                      <th scope="col">Did not buy</th>
                      <th scope="col">Revenue of those who raised it</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.map((r) => (
                      <tr key={r.pain} style={r.tooSmall ? { color: "var(--muted)" } : undefined}>
                        <th scope="row">
                          {PAIN_LABELS[r.pain]}
                          {r.tooSmall && <small> Fewer than 30 customers, too small to trust.</small>}
                        </th>
                        <td>{formatCount(r.mentions)}</td>
                        <td>{formatCount(r.severe)}</td>
                        <td>{formatCount(r.notBought)}</td>
                        <td>{formatCount(r.revenue)} dollars</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="h-chain">
            <h2 id="h-chain">Evidence chain</h2>
            <p>
              From a theme to revenue, one link at a time. A missing link is shown as missing, not filled in. Every link
              before the ledger test is an association.
            </p>
            <p>
              <label>
                Theme{" "}
                <select value={chainPain} onChange={(e) => setChainPain(e.target.value as Pain)}>
                  {THEMES.map((p) => (
                    <option key={p} value={p}>
                      {PAIN_LABELS[p]}
                    </option>
                  ))}
                </select>
              </label>
            </p>
            {chain && (
              <ol aria-label={`Evidence chain for ${PAIN_LABELS[chainPain]}`} className="chain">
                {chain.map((step) => (
                  <li key={step.kind} data-status={step.status}>
                    <strong>{step.label}</strong>
                    {step.status === "missing" && <span> Missing</span>}
                    <p>{step.text}</p>
                    {step.kind === "test" &&
                      (step.entryId ? (
                        <p>
                          <Link href={`/ledger/entry?id=${step.entryId}`}>Open the ledger entry</Link>
                        </p>
                      ) : (
                        <p>
                          A test is registered in the <Link href="/ledger">Ledger</Link>. Naming a theme on an entry
                          from the ledger screen is not built yet.
                        </p>
                      ))}
                  </li>
                ))}
              </ol>
            )}
            {drops && (
              <Explain
                summary="How the links were worked out"
                items={[
                  {
                    label: "Segments that carry it",
                    value: `${formatPercent(CARRIER_SHARE, 0)} of commenting customers`,
                    how:
                      `A segment and channel group carries a theme when at least ${formatPercent(CARRIER_SHARE, 0)} of its commenting ` +
                      "customers raised it. The share is a judgment from the plan, not a rule from statistics. Groups under 30 are left out.",
                  },
                  {
                    label: "Where it goes with stopping",
                    value: `${drops.comparisons} comparisons`,
                    how:
                      "At each step, the share raising the theme among commenting customers who stopped there is compared with those " +
                      "who went on. Each gap gets a pooled two proportion z test p value, and Benjamini Hochberg adjusts them across " +
                      `all ${drops.comparisons} comparisons at a false discovery rate of ${drops.q}. A step is compared only when both ` +
                      "groups have at least 30 customers. Each comment has one coded pain, so a group that raises one pain more raises " +
                      "others less, and a link can come from who the customers are rather than from the pain.",
                  },
                  {
                    label: "Revenue",
                    value: "synthetic",
                    how: "Each customer who bought has a synthetic order value from 20 to 400 dollars. Customers who did not buy have none.",
                  },
                ]}
              />
            )}
          </section>

          <section aria-labelledby="h-quotes">
            <h2 id="h-quotes">Read the comments</h2>
            <p>
              Redacted text only. You can correct a comment, for example to remove a name the rules missed. The edited
              text is redacted again before it is stored, so an edit cannot put a detail back in. The coded pain does
              not change.
            </p>
            <p>
              <label>
                Pain{" "}
                <select
                  value={pain}
                  onChange={(e) => {
                    const p = e.target.value as Pain;
                    setPain(p);
                    setSaved(null);
                    void showQuotes(p, 0).catch((err: unknown) => setError(messageOf(err)));
                  }}
                >
                  {PAINS.map((p) => (
                    <option key={p} value={p}>
                      {PAIN_LABELS[p]}
                    </option>
                  ))}
                </select>
              </label>
            </p>
            {saved && <p role="status">{saved}</p>}
            {page && (
              <>
                <p>
                  {page.total === 0
                    ? "No comments have this pain."
                    : `Comments ${formatCount(page.offset + 1)} to ${formatCount(page.offset + page.rows.length)} of ${formatCount(page.total)}.`}
                </p>
                <ol start={page.offset + 1}>
                  {page.rows.map((r) => (
                    <li key={r.customer}>
                      <p>
                        <small>
                          Customer {r.customer}, {r.segment}, {r.channel}, reached {r.reached}, severity {r.severity} of 3
                        </small>
                      </p>
                      {editing === r.customer ? (
                        <>
                          <label>
                            Corrected text for customer {r.customer}
                            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} style={{ width: "100%" }} />
                          </label>
                          <p>
                            <button type="button" onClick={() => void onSave(r.customer)}>
                              Save and redact again
                            </button>{" "}
                            <button type="button" onClick={() => setEditing(null)}>
                              Cancel
                            </button>
                          </p>
                        </>
                      ) : (
                        <>
                          <blockquote>{r.text}</blockquote>
                          <p>
                            <button
                              type="button"
                              aria-label={`Correct the comment from customer ${r.customer}`}
                              onClick={() => {
                                setEditing(r.customer);
                                setDraft(r.text);
                                setSaved(null);
                              }}
                            >
                              Correct
                            </button>
                          </p>
                        </>
                      )}
                    </li>
                  ))}
                </ol>
                <p>
                  <button type="button" disabled={page.offset === 0} onClick={() => void showQuotes(pain, Math.max(0, page.offset - QUOTE_PAGE))}>
                    Previous
                  </button>{" "}
                  <button
                    type="button"
                    disabled={page.offset + QUOTE_PAGE >= page.total}
                    onClick={() => void showQuotes(pain, page.offset + QUOTE_PAGE)}
                  >
                    Next
                  </button>
                </p>
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}
