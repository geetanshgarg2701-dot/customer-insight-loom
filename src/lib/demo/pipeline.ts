import { mulberry32 } from "../stats/honesty";

/**
 * Synthetic sales pipeline for the pipeline views. Labels and times only, so nothing here can identify anyone. The
 * generator doubles as the test fixture, plan section 5.14, because every answer is known.
 *
 * Planted facts: enterprise deals sit in Proposal about three times longer than small ones and win less often.
 * Times are UTC text without a zone, the form the database reads. Deals that have not reached a stage by the cutoff
 * have no time for it. A deal that stops moving is marked lost some weeks later, unless that time is after the cutoff,
 * in which case it is still open. Open deals are the only ones that can be stalled.
 */

export const PIPELINE_STAGES = ["Lead", "Qualified", "Proposal", "Won"] as const;
export const PIPELINE_SEGMENTS = ["smb", "mid", "enterprise"] as const;
export const PIPELINE_SOURCES = ["inbound", "outbound", "referral"] as const;

/** The cutoff for "now" in the demo, so every number is reproducible. */
export const PIPELINE_AS_OF = "2026-11-01T00:00:00Z";

export type PipelineRow = {
  segment: (typeof PIPELINE_SEGMENTS)[number];
  source: (typeof PIPELINE_SOURCES)[number];
  /** When the deal entered each stage, or null if it never did. A stage is null only if every later one is too. */
  entered: (string | null)[];
  /** The furthest stage reached. */
  stage: (typeof PIPELINE_STAGES)[number];
  /** When a stalled deal was closed as lost, or null. */
  lostAt: string | null;
  status: "won" | "lost" | "open";
};

/** Median days between a deal going quiet and someone marking it lost. */
const LOST_WAIT_DAYS = 25;

const DAY_MS = 86_400_000;
const PICK_SEGMENT: readonly [(typeof PIPELINE_SEGMENTS)[number], number][] = [["smb", 0.5], ["mid", 0.3], ["enterprise", 0.2]];
const PICK_SOURCE: readonly [(typeof PIPELINE_SOURCES)[number], number][] = [["inbound", 0.5], ["outbound", 0.3], ["referral", 0.2]];

/** Chance of moving on from each of the first three stages. */
const CONTINUE = {
  smb: [0.6, 0.6, 0.5],
  mid: [0.55, 0.6, 0.4],
  enterprise: [0.5, 0.6, 0.3],
} as const;

/** Median days spent in each of the first three stages before moving on. */
const MEDIAN_DAYS = {
  smb: [3, 5, 9],
  mid: [4, 7, 14],
  enterprise: [6, 10, 28],
} as const;

function pick<T>(table: readonly [T, number][], u: number): T {
  let acc = 0;
  for (const [value, p] of table) {
    acc += p;
    if (u < acc) return value;
  }
  return table[table.length - 1][0];
}

function utcText(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

export function syntheticPipeline(count: number, seed: number): PipelineRow[] {
  const rng = mulberry32(seed);
  const asOf = Date.parse(PIPELINE_AS_OF);
  const normal = () => Math.sqrt(-2 * Math.log(rng() || 1e-12)) * Math.cos(2 * Math.PI * rng());
  const rows: PipelineRow[] = [];
  for (let i = 0; i < count; i++) {
    const segment = pick(PICK_SEGMENT, rng());
    const source = pick(PICK_SOURCE, rng());
    let at = Math.floor((asOf - rng() * 330 * DAY_MS) / 1000) * 1000;
    const entered: (string | null)[] = PIPELINE_STAGES.map(() => null);
    entered[0] = utcText(at);
    let reached = 1;
    let quit = false;
    for (let s = 0; s < 3; s++) {
      if (rng() >= CONTINUE[segment][s]) {
        quit = true;
        break;
      }
      const dwell = MEDIAN_DAYS[segment][s] * Math.exp(0.7 * normal()) * DAY_MS;
      const next = Math.floor((at + dwell) / 1000) * 1000;
      if (next > asOf) break; // has not happened yet at the cutoff, so the deal is still open
      at = next;
      entered[s + 1] = utcText(at);
      reached++;
    }
    let lostAt: string | null = null;
    if (quit) {
      const lostMs = Math.floor((at + LOST_WAIT_DAYS * Math.exp(0.8 * normal()) * DAY_MS) / 1000) * 1000;
      if (lostMs <= asOf) lostAt = utcText(lostMs);
    }
    const stage = PIPELINE_STAGES[reached - 1];
    rows.push({ segment, source, entered, stage, lostAt, status: stage === "Won" ? "won" : lostAt ? "lost" : "open" });
  }
  return rows;
}
