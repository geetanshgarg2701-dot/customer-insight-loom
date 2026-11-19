/**
 * The theme to revenue evidence chain, plan sections 6.4 and M6. For one coded pain it lays out, in order:
 * the theme and how often it is raised, the segments that carry it, the journey steps where it goes with stopping,
 * the revenue of the customers who raised it, the ledger test that names it, and the decision.
 *
 * Every link is an association. Only a ledger entry with a holdout can support a causal reading, and the chain says so
 * when there is none. Step links are a discovery scan across many pains and steps, so their p values are adjusted with
 * Benjamini Hochberg, the method plan section 6.3 chose for discovery scans, and the number of comparisons is shown.
 */
import { MIN_GROUP } from "../charts/compare";
import { JOURNEY_STEPS, type JourneyRow } from "../demo/journeys";
import { toPlainRow } from "../duckdb/normalize";
import type { SqlEngine } from "../intake/types";
import { insertRows } from "../ledger/ledger";
import { formatCount, formatPercent } from "../app/format";
import { benjaminiHochberg } from "../stats/bh";
import { mulberry32 } from "../stats/honesty";
import { newcombeDifference, twoProportionPValue } from "../stats/readout";
import { PAINS, type Pain } from "./comments";

export type EvidenceTables = { comments: string; journeys: string; revenue: string };

/** Fixed theme ids, so a ledger entry can name a theme. The ledger only accepts UUIDs as theme ids. */
export const THEME_IDS: Readonly<Record<Pain, string>> = {
  shipping_cost: "3b0c6a1e-5f2d-4c8e-9a71-0d1e2f3a4b01",
  pricing: "3b0c6a1e-5f2d-4c8e-9a71-0d1e2f3a4b02",
  slow_delivery: "3b0c6a1e-5f2d-4c8e-9a71-0d1e2f3a4b03",
  support_slow: "3b0c6a1e-5f2d-4c8e-9a71-0d1e2f3a4b04",
  site_bugs: "3b0c6a1e-5f2d-4c8e-9a71-0d1e2f3a4b05",
  product_info: "3b0c6a1e-5f2d-4c8e-9a71-0d1e2f3a4b06",
  no_issue: "3b0c6a1e-5f2d-4c8e-9a71-0d1e2f3a4b07",
};

/** The theme a ledger entry names, or null for none, for no complaint, or for an id this app did not issue. */
export function themeOf(themeId: string | null): Pain | null {
  if (themeId === null) return null;
  const found = (Object.keys(THEME_IDS) as Pain[]).find((p) => THEME_IDS[p] === themeId);
  return found === undefined || found === "no_issue" ? null : found;
}

/** The pains that are themes. A comment with no complaint is not a theme. */
export const THEMES: readonly Pain[] = PAINS.filter((p) => p !== "no_issue");

/** A segment carries a theme when at least this share of its commenting customers raised it. A judgment, plan 6.4. */
export const CARRIER_SHARE = 0.2;
const Q = 0.05;
const ALPHA = 0.05;
const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;

function checkTables(t: EvidenceTables): void {
  for (const name of [t.comments, t.journeys, t.revenue]) {
    if (!TABLE_NAME.test(name)) throw new RangeError("Table name must be lower case letters, digits and underscores.");
  }
}

/**
 * Synthetic revenue per customer, from its own seeded stream so it changes no journey or comment. Only customers who
 * bought have revenue: a whole number of dollars from 20 to 400, skewed toward small orders.
 */
export function customerRevenue(journeys: readonly JourneyRow[], seed: number): number[] {
  const rng = mulberry32(seed);
  return journeys.map((j) => {
    const u = rng();
    return j.reached === "Purchase" ? 20 + Math.floor(u * u * 381) : 0;
  });
}

export async function loadRevenue(engine: SqlEngine, table: string, amounts: readonly number[]): Promise<void> {
  if (!TABLE_NAME.test(table)) throw new RangeError("Table name must be lower case letters, digits and underscores.");
  await engine.exec(`CREATE OR REPLACE TABLE ${table} (customer INTEGER, amount BIGINT)`);
  await insertRows(engine, table, ["customer", "amount"], amounts.map((a, i) => [i, a]));
}

export type RankRow = {
  pain: Pain;
  mentions: number;
  severe: number;
  notBought: number;
  revenue: number;
  tooSmall: boolean;
};

/** Mentions per theme, with severity, buying and summed revenue of the customers who raised it. Most mentioned first. */
export async function painRanking(engine: SqlEngine, t: EvidenceTables): Promise<RankRow[]> {
  checkTables(t);
  const rows = (
    await engine.query(
      `SELECT c.pain AS pain, count(*) AS n, count(*) FILTER (WHERE c.severity = 3) AS severe, ` +
        `count(*) FILTER (WHERE j.reached <> 'Purchase') AS not_bought, COALESCE(sum(r.amount), 0) AS revenue ` +
        `FROM ${t.comments} c JOIN ${t.journeys} j ON j.customer = c.customer ` +
        `LEFT JOIN ${t.revenue} r ON r.customer = c.customer GROUP BY c.pain`,
      [],
    )
  ).map(toPlainRow);
  const by = new Map(rows.map((r) => [String(r.pain), r]));
  return THEMES.map((pain) => {
    const r = by.get(pain);
    const mentions = r ? Number(r.n) : 0;
    return {
      pain,
      mentions,
      severe: r ? Number(r.severe) : 0,
      notBought: r ? Number(r.not_bought) : 0,
      revenue: r ? Number(r.revenue) : 0,
      tooSmall: mentions < MIN_GROUP,
    };
  }).sort((a, b) => b.mentions - a.mentions || THEMES.indexOf(a.pain) - THEMES.indexOf(b.pain));
}

export type DropLink = {
  pain: Pain;
  /** The step where people stopped, compared with those who went on from it. */
  step: string;
  stopped: number;
  stoppedWith: number;
  wentOn: number;
  wentOnWith: number;
  difference: number;
  low: number;
  high: number;
  p: number;
  adjusted: number;
  flagged: boolean;
};
export type DropLinks = { comparisons: number; q: number; links: DropLink[] };

const STEP_COLUMNS = ["s1", "s2", "s3", "s4"] as const;

/**
 * At each step but the last, the share of commenting customers with each theme among those who stopped there against
 * those who went on. A step is compared only when both groups have at least 30 customers.
 */
export async function dropOffLinks(engine: SqlEngine, t: EvidenceTables): Promise<DropLinks> {
  checkTables(t);
  const raw: Omit<DropLink, "adjusted" | "flagged">[] = [];
  for (let k = 0; k < JOURNEY_STEPS.length - 1; k++) {
    const rows = (
      await engine.query(
        `SELECT c.pain AS pain, (j.${STEP_COLUMNS[k + 1]} IS NULL) AS stopped, count(*) AS n ` +
          `FROM ${t.comments} c JOIN ${t.journeys} j ON j.customer = c.customer ` +
          `WHERE j.${STEP_COLUMNS[k]} IS NOT NULL GROUP BY 1, 2`,
        [],
      )
    ).map(toPlainRow);
    const count = (pain: string | null, stopped: boolean) =>
      rows.filter((r) => Boolean(r.stopped) === stopped && (pain === null || String(r.pain) === pain)).reduce((n, r) => n + Number(r.n), 0);
    const stopped = count(null, true);
    const wentOn = count(null, false);
    if (stopped < MIN_GROUP || wentOn < MIN_GROUP) continue;
    for (const pain of THEMES) {
      const stoppedWith = count(pain, true);
      const wentOnWith = count(pain, false);
      const ci = newcombeDifference(stoppedWith, stopped, wentOnWith, wentOn, ALPHA);
      raw.push({
        pain,
        step: JOURNEY_STEPS[k],
        stopped,
        stoppedWith,
        wentOn,
        wentOnWith,
        difference: stoppedWith / stopped - wentOnWith / wentOn,
        low: ci.low,
        high: ci.high,
        p: twoProportionPValue(stoppedWith, stopped, wentOnWith, wentOn),
      });
    }
  }
  if (raw.length === 0) return { comparisons: 0, q: Q, links: [] };
  const bh = benjaminiHochberg(raw.map((l) => l.p), Q);
  return {
    comparisons: bh.comparisons,
    q: Q,
    links: raw.map((l, i) => ({ ...l, adjusted: bh.adjusted[i], flagged: bh.rejected[i] })),
  };
}

export type Carrier = { pain: Pain; segment: string; channel: string; customers: number; tagged: number; share: number };

/** Segment and channel groups whose share of commenting customers raising a theme is at least `threshold`. */
export async function segmentCarriers(engine: SqlEngine, t: EvidenceTables, threshold: number): Promise<Carrier[]> {
  checkTables(t);
  if (!(threshold > 0 && threshold <= 1)) throw new RangeError("The share must be above 0 and at most 1.");
  const rows = (
    await engine.query(
      `SELECT j.segment AS segment, j.channel AS channel, c.pain AS pain, count(*) AS n ` +
        `FROM ${t.comments} c JOIN ${t.journeys} j ON j.customer = c.customer GROUP BY 1, 2, 3`,
      [],
    )
  ).map(toPlainRow);
  const totals = new Map<string, number>();
  for (const r of rows) {
    const key = `${String(r.segment)}|${String(r.channel)}`;
    totals.set(key, (totals.get(key) ?? 0) + Number(r.n));
  }
  const out: Carrier[] = [];
  for (const r of rows) {
    const pain = String(r.pain) as Pain;
    if (!THEMES.includes(pain)) continue;
    const customers = totals.get(`${String(r.segment)}|${String(r.channel)}`)!;
    const tagged = Number(r.n);
    if (customers < MIN_GROUP || tagged / customers < threshold) continue;
    out.push({ pain, segment: String(r.segment), channel: String(r.channel), customers, tagged, share: tagged / customers });
  }
  return out.sort((a, b) => THEMES.indexOf(a.pain) - THEMES.indexOf(b.pain) || b.share - a.share || a.segment.localeCompare(b.segment));
}

export type ChainEntry = { id: string; title: string; themeId: string | null; status: string };

export type ChainStep = {
  kind: "theme" | "segment" | "path" | "revenue" | "test" | "decision";
  label: string;
  text: string;
  status: "present" | "missing";
  entryId?: string;
};

/** The chain for one theme, from what is already worked out. Builds sentences only and computes no statistic. */
export function assembleChain(
  pain: Pain,
  ranking: readonly RankRow[],
  drops: DropLinks,
  carriers: readonly Carrier[],
  entries: readonly ChainEntry[],
): ChainStep[] {
  const rank = ranking.find((r) => r.pain === pain);
  const mine = carriers.filter((c) => c.pain === pain);
  const links = drops.links.filter((l) => l.pain === pain && l.flagged && l.difference > 0);
  const tests = entries.filter((e) => e.themeId === THEME_IDS[pain]);
  const pct = (x: number) => formatPercent(x, 1);

  const theme: ChainStep = rank && rank.mentions > 0
    ? { kind: "theme", label: "Theme", status: "present", text: `${formatCount(rank.mentions)} comments, ${formatCount(rank.severe)} of them rated severe.` }
    : { kind: "theme", label: "Theme", status: "missing", text: "No comments are coded with this theme." };

  const segment: ChainStep = mine.length > 0
    ? {
        kind: "segment",
        label: "Segments that carry it",
        status: "present",
        text: mine.map((c) => `${c.segment}, ${c.channel}: ${pct(c.share)} of ${formatCount(c.customers)} commenting customers raised it.`).join(" "),
      }
    : { kind: "segment", label: "Segments that carry it", status: "missing", text: `No segment reaches ${pct(CARRIER_SHARE)}.` };

  const path: ChainStep = links.length > 0
    ? {
        kind: "path",
        label: "Where it goes with stopping",
        status: "present",
        text:
          links
            .map(
              (l) =>
                `At ${l.step}, ${pct(l.stoppedWith / l.stopped)} of those who stopped raised it, against ` +
                `${pct(l.wentOnWith / l.wentOn)} of those who went on.`,
            )
            .join(" ") + ` Association, not cause. Flagged after Benjamini Hochberg across ${drops.comparisons} comparisons.`,
      }
    : {
        kind: "path",
        label: "Where it goes with stopping",
        status: "missing",
        text: `No step shows a higher share among those who stopped, after Benjamini Hochberg across ${drops.comparisons} comparisons.`,
      };

  const revenue: ChainStep = rank && rank.mentions > 0
    ? {
        kind: "revenue",
        label: "Revenue of those who raised it",
        status: "present",
        text: `${formatCount(rank.revenue)} dollars from the ${formatCount(rank.mentions)} customers who raised it. ${formatCount(rank.notBought)} of them did not buy.`,
      }
    : { kind: "revenue", label: "Revenue of those who raised it", status: "missing", text: "No customers raised it." };

  const test: ChainStep = tests.length > 0
    ? { kind: "test", label: "Ledger test", status: "present", text: tests.map((e) => `${e.title}, ${e.status}.`).join(" "), entryId: tests[0].id }
    : { kind: "test", label: "Ledger test", status: "missing", text: "No ledger entry names this theme yet." };

  const closed = tests.find((e) => e.status === "closed");
  const decision: ChainStep = closed
    ? { kind: "decision", label: "Decision", status: "present", text: "A test on this theme is closed. Read its result in the ledger.", entryId: closed.id }
    : { kind: "decision", label: "Decision", status: "missing", text: "No decision. A decision needs a test with a holdout behind it." };

  return [theme, segment, path, revenue, test, decision];
}
