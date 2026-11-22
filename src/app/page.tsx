import Link from "next/link";
import type { CSSProperties } from "react";
import { PILOT } from "@/lib/pilot/enabled";
import { GuidedTour } from "./guided-tour";

type Screen = { href: string; name: string; what: string };

const GROUPS: { id: string; title: string; intro: string; screens: Screen[] }[] = [
  {
    id: "experiments",
    title: "Experiments",
    intro: "Write the bet down before you send, and read the result once.",
    screens: [
      { href: "/ledger", name: "Ledger", what: "Record a hypothesis, check the audience is large enough, hold back a control group and read out the result." },
      { href: "/compliance", name: "Email check", what: "Check an email against US email law and the Gmail and Yahoo sender rules, with the source of each rule." },
      { href: "/drafts", name: "Email drafts", what: "Draft an email for a segment and a complaint in PAS, FAB or AIDA, then approve it in a sandbox." },
    ],
  },
  {
    id: "customers",
    title: "Customers",
    intro: "Where people drop off, where deals wait, and what customers say about it.",
    screens: [
      { href: "/journeys", name: "Journeys", what: "Linked charts of 100,000 synthetic customers, the designed journey and who is behind each step." },
      { href: "/pipeline", name: "Pipeline", what: "How long deals sit in each stage, which have stalled, and the pipeline on any past date." },
      { href: "/insights", name: "Comments", what: "Themes in customer comments, with names removed, and the evidence chain from a complaint to revenue." },
    ],
  },
  {
    id: "data",
    title: "Your data",
    intro: "Bring files in, check them, and see what this tab holds.",
    screens: [
      { href: "/intake", name: "Data intake", what: "Load a CSV and map its columns. Columns that look like names, emails or phone numbers are blocked." },
      { href: "/check", name: "Data check", what: "Match two files on email and check a time column against clock changes." },
      { href: "/ingest", name: "Webhooks", what: "Try the receiver for events from other tools, with signing, limits and step names to map." },
      { href: "/data", name: "Your data", what: "What this tab holds, how much memory it uses, and a control to delete everything." },
    ],
  },
];

export default function Home() {
  return (
    <main>
      <div className="hero">
        <div className="hero-copy">
          <span className="badge">Your files stay in your browser</span>
          <h1>
            <span className="line">
              <span>Customer Insight</span>
            </span>{" "}
            <span className="line">
              <span>Loom</span>
            </span>
          </h1>
          <p className="home-lead">
            Customer journeys, pipelines and email experiments in one picture, with the evidence kept and the uncertainty
            shown. When a result is too small to tell, it says so plainly.
          </p>
          <div className="cta">
            <Link className="button-link" href="/ledger">
              Start with the experiment ledger
            </Link>
            <Link className="button-link plain" href="/journeys">
              Explore customer journeys
            </Link>
          </div>
          <dl className="hero-stats">
            <div>
              <dd>
                <span className="sr-only">100,000</span>
                <span className="count" style={{ "--to": 100 } as CSSProperties} aria-hidden="true" />
                <span aria-hidden="true">k</span>
              </dd>
              <dt>demo customers</dt>
            </div>
            <div>
              <dd>
                <span className="sr-only">95 percent</span>
                <span className="count" style={{ "--to": 95 } as CSSProperties} aria-hidden="true" />
                <span aria-hidden="true">%</span>
              </dd>
              <dt>range on results</dt>
            </div>
            <div>
              <dd>0</dd>
              <dt>files uploaded</dt>
            </div>
          </dl>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="stack">
            <i className="layer l1" />
            <i className="layer l2" />
            <i className="layer l3" />
            <i className="layer l4" />
          </div>
          <div className="float-card fc1">
            Experiment ledger
            <strong>Lift +1.8 points</strong>
            Range 0.6 to 3.0. Example.
          </div>
          <div className="float-card fc2">
            Journeys
            <strong>100,000 demo customers</strong>
            Where people drop off. Example.
          </div>
        </div>
      </div>

      <GuidedTour />

      <div className="home-groups">
        {GROUPS.map((g) => (
          <section key={g.id} aria-labelledby={`h-${g.id}`}>
            <h2 id={`h-${g.id}`}>{g.title}</h2>
            <p>{g.intro}</p>
            <ul>
              {g.screens.map((s) => (
                <li key={s.href}>
                  <Link href={s.href}>{s.name}</Link>
                  <p>{s.what}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section aria-labelledby="h-privacy">
        <h2 id="h-privacy">Where your data goes</h2>
        {PILOT ? (
          <p>
            Files you load stay in this browser tab. This build has pilot accounts: if you sign in on the Account screen,
            ledger files you choose to save are stored with the pilot&rsquo;s database service, and nothing else leaves the
            tab. See <Link href="/privacy">Privacy</Link>.
          </p>
        ) : (
          <p>
            Your files stay in your browser. There is no account, and nothing you load is sent to a server. See{" "}
            <Link href="/privacy">Privacy</Link> for the details.
          </p>
        )}
        <p>
          This is an early version. It has not been tried on real customer data, and names are only partly removed from
          text. The <Link href="/ledger">Ledger</Link> has demo data that shows the whole path, and{" "}
          <Link href="/methods">Methods</Link> lists the checks run on the statistics.
        </p>
      </section>
    </main>
  );
}
