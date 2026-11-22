"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { PILOT } from "@/lib/pilot/enabled";

/**
 * The sidebar. Screens are grouped by what a marketer is doing, and the current one is marked for sight and for screen
 * readers. Client side links keep the in-browser ledger alive between screens.
 */

type Item = { href: string; label: string; icon: ReactNode };

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false" {...stroke}>
    {children}
  </svg>
);

const ICONS = {
  home: <Icon><path d="M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1Z" /></Icon>,
  ledger: <Icon><path d="M5 3h9l2 2v12H5Z" /><path d="M8 8h6M8 11h6M8 14h4" /></Icon>,
  check: <Icon><path d="M3 5h14v10H3Z" /><path d="m3 5 7 5 7-5" /><path d="m12.5 13.5 1.5 1.5 3-3" /></Icon>,
  draft: <Icon><path d="M4 16h3l8.5-8.5-3-3L4 13Z" /><path d="m11 6 3 3" /></Icon>,
  journeys: <Icon><circle cx="4.5" cy="10" r="1.8" /><circle cx="15.5" cy="5" r="1.8" /><circle cx="15.5" cy="15" r="1.8" /><path d="M6.3 10C10 10 10 5 13.7 5M6.3 10C10 10 10 15 13.7 15" /></Icon>,
  pipeline: <Icon><path d="M3 4h14l-5 6v5l-4 2v-7Z" /></Icon>,
  comments: <Icon><path d="M3 5h14v8H9l-4 3v-3H3Z" /></Icon>,
  intake: <Icon><path d="M10 3v9m-3.5-3.5L10 12l3.5-3.5" /><path d="M3 13v3h14v-3" /></Icon>,
  match: <Icon><circle cx="7.5" cy="10" r="4.5" /><circle cx="12.5" cy="10" r="4.5" /></Icon>,
  webhook: <Icon><path d="M7 7.5a3 3 0 1 1 5.2 2L10 13" /><circle cx="10" cy="15" r="1.6" /><path d="M5 16a3 3 0 0 1-.6-5.4" /><path d="M15 16a3 3 0 0 0 .6-5.4" /></Icon>,
  data: <Icon><ellipse cx="10" cy="5" rx="6" ry="2.2" /><path d="M4 5v10c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2V5" /><path d="M4 10c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2" /></Icon>,
  methods: <Icon><path d="M4 16 8 4l4 12M5.3 12h5.4" /><path d="M14 9h3M15.5 7.5v3" /></Icon>,
  account: <Icon><circle cx="10" cy="7" r="3" /><path d="M4 17c.8-3 3.2-4.5 6-4.5s5.2 1.5 6 4.5" /></Icon>,
};

const GROUPS: { label: string | null; items: Item[] }[] = [
  { label: null, items: [{ href: "/", label: "Home", icon: ICONS.home }] },
  {
    label: "Experiments",
    items: [
      { href: "/ledger", label: "Ledger", icon: ICONS.ledger },
      { href: "/compliance", label: "Email check", icon: ICONS.check },
      { href: "/drafts", label: "Email drafts", icon: ICONS.draft },
    ],
  },
  {
    label: "Customers",
    items: [
      { href: "/journeys", label: "Journeys", icon: ICONS.journeys },
      { href: "/pipeline", label: "Pipeline", icon: ICONS.pipeline },
      { href: "/insights", label: "Comments", icon: ICONS.comments },
    ],
  },
  {
    label: "Your data",
    items: [
      { href: "/intake", label: "Data intake", icon: ICONS.intake },
      { href: "/check", label: "Data check", icon: ICONS.match },
      { href: "/ingest", label: "Webhooks", icon: ICONS.webhook },
      { href: "/data", label: "Your data", icon: ICONS.data },
    ],
  },
  { label: "About", items: [{ href: "/methods", label: "Methods", icon: ICONS.methods }] },
];

/** The woven mark: three warp threads crossed by two weft threads. */
function Mark() {
  return (
    <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true" focusable="false">
      <rect width="28" height="28" rx="6" fill="#267a5b" />
      <path d="M8 5v18M14 5v18M20 5v18" stroke="#96d9c4" strokeWidth="2.4" />
      <path d="M5 11h4m2 0h6m2 0h4M5 17h1m4 0h2m4 0h2m4 0h1" stroke="#f1f5f3" strokeWidth="2.4" />
    </svg>
  );
}

const normalize = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

export function Nav() {
  const path = normalize(usePathname() ?? "/");
  const current = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  const groups = PILOT ? [...GROUPS, { label: "Pilot", items: [{ href: "/account", label: "Account", icon: ICONS.account }] }] : GROUPS;
  return (
    <nav aria-label="Main" className="sidebar">
      <Link href="/" className="brand">
        <Mark />
        <span>Customer Insight Loom</span>
      </Link>
      {groups.map((g) => (
        <div key={g.label ?? "start"} className="nav-group">
          {g.label && <p className="nav-label">{g.label}</p>}
          <ul>
            {g.items.map((it) => (
              <li key={it.href}>
                <Link href={it.href} aria-current={current(it.href) ? "page" : undefined}>
                  {it.icon}
                  <span>{it.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
