/**
 * Version 1 holdout flow, plan section 6.2, with the decisions confirmed on
 * 2026-11-16:
 * 1. The email is read only to hash it, then dropped. Only the hash is stored.
 * 2. The download repeats the user's own email next to the group, so their
 *    send tool can use it. It is built in the browser and never stored.
 * 3. A results upload is checked against the stored assignment. Unknown
 *    people, wrong groups, duplicates and bad values are excluded and counted.
 */
import type { SqlEngine, SqlParam } from "../intake/types";
import { insertRows, type Arm, type Ledger } from "../ledger/ledger";
import { toPlainRow } from "../duckdb/normalize";
import { checkConversionTime, emptyTimeCounts, type TimeContext, type TimeCounts } from "./conversion-time";
import { experimentReadout, type ExperimentReadout } from "../stats/experiment";
import { revenueReadout, type RevenueReadout } from "../stats/revenue";
import { csvCell } from "../app/csv";
import { bucketOf, customerHash, looksLikeEmail, normalizeEmail, unprotect } from "./hash";

const HASH_BATCH = 1000;

export type AssignedRow = { email: string; arm: Arm };

export type AssignResult = {
  assigned: number;
  treatment: number;
  control: number;
  duplicates: number;
  invalid: number;
  /** For the download only. Held in memory, never stored. */
  rows: AssignedRow[];
};

export function shareToThreshold(share: number): number {
  const pct = share * 100;
  if (!Number.isFinite(share) || share <= 0 || share >= 1 || Math.abs(pct - Math.round(pct)) > 1e-9) {
    throw new RangeError("Treatment share must be a whole percent from 1 to 99 percent.");
  }
  return Math.round(pct);
}

export async function assignAudience(input: {
  ledger: Ledger;
  entryId: string;
  emails: readonly (string | null)[];
  treatmentShare: number;
}): Promise<AssignResult> {
  const { ledger, entryId, emails } = input;
  const threshold = shareToThreshold(input.treatmentShare);
  if ((await ledger.listAssignments(entryId)).length > 0) {
    throw new Error("This entry already has its assignment. It cannot be redone, so no one is reshuffled.");
  }
  const secret = await ledger.workspaceSecret();

  let invalid = 0;
  let duplicates = 0;
  const valid: string[] = [];
  for (const raw of emails) {
    const email = raw === null ? "" : normalizeEmail(raw);
    if (!looksLikeEmail(email)) invalid++;
    else valid.push(email);
  }

  const seen = new Set<string>();
  const rows: AssignedRow[] = [];
  const records: { customerEmailHash: string; arm: Arm }[] = [];
  for (let i = 0; i < valid.length; i += HASH_BATCH) {
    const batch = valid.slice(i, i + HASH_BATCH);
    const hashes = await Promise.all(batch.map((e) => customerHash(secret, e)));
    const buckets = await Promise.all(hashes.map((h) => bucketOf(secret, entryId, h)));
    batch.forEach((email, j) => {
      const h = hashes[j];
      if (seen.has(h)) {
        duplicates++;
        return;
      }
      seen.add(h);
      const arm: Arm = buckets[j] < threshold ? "treatment" : "control";
      rows.push({ email, arm });
      records.push({ customerEmailHash: h, arm });
    });
  }

  await ledger.recordAssignments(entryId, records);
  const treatment = records.filter((r) => r.arm === "treatment").length;
  return { assigned: records.length, treatment, control: records.length - treatment, duplicates, invalid, rows };
}

export { csvCell };

/** The download for the user's send tool: their email, the group, the entry. */
export function assignmentCsv(rows: readonly AssignedRow[], entryId: string): string {
  const out = ["email,group,entry_id", ...rows.map((r) => [r.email, r.arm, entryId].map(csvCell).join(","))];
  return out.join("\r\n") + "\r\n";
}

function parseGroup(raw: string | null): Arm | "invalid" {
  const g = (raw ?? "").trim().toLowerCase();
  return g === "treatment" || g === "control" ? g : "invalid";
}

/** Blank means the conversion window is still open. */
function parseConverted(raw: string | null): boolean | null | "invalid" {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "") return null;
  if (["1", "true", "yes", "y"].includes(v)) return true;
  if (["0", "false", "no", "n"].includes(v)) return false;
  return "invalid";
}

/**
 * Revenue is a plain number: digits with an optional decimal part. A currency sign, a thousands separator, an exponent and a
 * negative are not guessed at. Blank means not reported.
 */
function parseRevenue(raw: string | null | undefined): number | null | "invalid" {
  const v = (raw ?? "").trim();
  if (v === "") return null;
  if (!/^\d+(\.\d+)?$/.test(v)) return "invalid";
  const n = Number(v);
  return Number.isFinite(n) ? n : "invalid";
}

export type Verification = {
  rows: number;
  matched: number;
  /** People in the upload who were never assigned. */
  unknown: number;
  /** Rows whose group differs from the stored assignment. */
  groupMismatch: number;
  /** Rows for a person who appears more than once. All copies are dropped. */
  duplicate: number;
  invalid: number;
  /** Assigned people with no row in the upload. */
  missing: number;
  /** What the time rules did. Absent when the file has no time column or no launch details were given. */
  time?: TimeCounts;
};

const RESULTS_TABLE = "experiment_results";

export async function verifyResults(input: {
  engine: SqlEngine;
  ledger: Ledger;
  entryId: string;
  /** A revenue key on the rows, even a blank one, says the file has a revenue column. Without the key there is no revenue result. */
  rows: readonly {
    email: string | null;
    group: string | null;
    converted: string | null;
    received?: string | null;
    revenue?: string | null;
    /** When the person converted. A key on the rows, even a blank one, says the file has a time column. */
    convertedAt?: string | null;
  }[];
  treatmentShare: number;
  alpha?: number;
  /** Launch, window and zone. With a time column, the time rules run against these. */
  time?: TimeContext;
}): Promise<{ verification: Verification; readout: ExperimentReadout; revenue: RevenueReadout | null }> {
  const { engine, ledger, entryId } = input;
  const secret = await ledger.workspaceSecret();
  const stored = new Map((await ledger.listAssignments(entryId)).map((a) => [a.customerEmailHash, a.arm]));

  let invalid = 0;
  const hasRevenue = input.rows.some((r) => r.revenue !== undefined);
  let invalidRevenue = 0;
  const timeCounts = input.time && input.rows.some((r) => r.convertedAt !== undefined) ? emptyTimeCounts(input.time.timeZone) : null;
  const parsed: { hash: string; group: Arm; converted: boolean | null; received: boolean | null; revenue: number | null; convertedAt: string | null }[] = [];
  const touched = new Set<string>();
  for (let i = 0; i < input.rows.length; i += HASH_BATCH) {
    const batch = input.rows.slice(i, i + HASH_BATCH).map((r) => {
      const email = normalizeEmail(unprotect(r.email ?? ""));
      const received = parseConverted(r.received ?? null);
      // A received value that cannot be read counts as not reported. It does not invalidate the row.
      const revenue = parseRevenue(r.revenue);
      return { email, group: parseGroup(r.group), converted: parseConverted(r.converted), received: received === "invalid" ? null : received, revenue, convertedAt: r.convertedAt ?? null };
    });
    const hashes = await Promise.all(
      batch.map((b) => (looksLikeEmail(b.email) ? customerHash(secret, b.email) : Promise.resolve(null))),
    );
    batch.forEach((b, j) => {
      const hash = hashes[j];
      if (hash !== null) touched.add(hash);
      if (hash === null || b.group === "invalid" || b.converted === "invalid") {
        invalid++;
        return;
      }
      parsed.push({ hash, group: b.group, converted: b.converted, received: b.received, revenue: b.revenue === "invalid" ? null : b.revenue, convertedAt: b.convertedAt });
      if (b.revenue === "invalid") invalidRevenue++;
    });
  }

  const byHash = new Map<string, typeof parsed>();
  for (const p of parsed) byHash.set(p.hash, [...(byHash.get(p.hash) ?? []), p]);

  let unknown = 0;
  let groupMismatch = 0;
  let duplicate = 0;
  const matched: SqlParam[][] = [];
  for (const [hash, list] of byHash) {
    if (list.length > 1) {
      duplicate += list.length;
      continue;
    }
    const arm = stored.get(hash);
    if (arm === undefined) unknown++;
    else if (arm !== list[0].group) groupMismatch++;
    else {
      const row = list[0];
      let converted = row.converted;
      let revenue = row.revenue;
      // The time rules apply only to someone who converted, and only once the row has passed the other checks.
      if (timeCounts && input.time && converted === true) {
        const verdict = checkConversionTime(row.convertedAt, input.time);
        if (verdict === "in_window") timeCounts.inWindow++;
        else if (verdict === "none") timeCounts.noTime++;
        else if (verdict === "after_window") {
          // They converted, but not in the window. They stay in the count as not converted, and their revenue goes with it.
          timeCounts.afterWindow++;
          converted = false;
          revenue = null;
        } else {
          if (verdict === "before_launch") timeCounts.beforeLaunch++;
          else if (verdict === "impossible") timeCounts.impossible++;
          else if (verdict === "ambiguous") timeCounts.ambiguous++;
          else timeCounts.unreadable++;
          continue;
        }
      }
      matched.push([arm, converted, row.received, revenue]);
    }
  }
  let missing = 0;
  for (const hash of stored.keys()) if (!touched.has(hash)) missing++;

  // The table holds group and outcome only. No identity reaches it.
  await engine.exec(`CREATE OR REPLACE TABLE ${RESULTS_TABLE} (arm VARCHAR NOT NULL, converted BOOLEAN, received BOOLEAN, revenue DOUBLE)`);
  await insertRows(engine, RESULTS_TABLE, ["arm", "converted", "received", "revenue"], matched);
  const readout = await experimentReadout(engine, RESULTS_TABLE, {
    treatmentShare: input.treatmentShare,
    alpha: input.alpha,
  });

  const revenue = hasRevenue ? await revenueResult(engine, input.alpha, invalidRevenue) : null;

  return {
    revenue,
    verification: {
      rows: input.rows.length,
      matched: matched.length,
      unknown,
      groupMismatch,
      duplicate,
      invalid,
      missing,
      ...(timeCounts ? { time: timeCounts } : {}),
    },
    readout,
  };
}

/**
 * Revenue per recipient for the people whose window has closed, from the results table. A person who did not convert counts
 * as zero revenue. The variance is the database's own sample variance.
 */
async function revenueResult(engine: SqlEngine, alpha: number | undefined, invalidValues: number): Promise<RevenueReadout> {
  const rows = (
    await engine.all(
      `SELECT arm, ` +
        `count(*) FILTER (WHERE converted IS NOT NULL) AS n, ` +
        `coalesce(sum(CASE WHEN converted THEN revenue ELSE 0 END) FILTER (WHERE converted IS NOT NULL), 0) AS total, ` +
        `coalesce(var_samp(CASE WHEN converted THEN coalesce(revenue, 0) ELSE 0 END) FILTER (WHERE converted IS NOT NULL), 0) AS spread, ` +
        `count(*) FILTER (WHERE converted) AS purchasers, ` +
        `count(*) FILTER (WHERE converted AND revenue IS NULL) AS unreported, ` +
        `count(*) FILTER (WHERE converted = false AND revenue IS NOT NULL) AS ignored ` +
        `FROM ${RESULTS_TABLE} GROUP BY arm`,
    )
  ).map(toPlainRow);
  const empty = () => ({ n: 0, sum: 0, variance: 0, purchasers: 0 });
  const arms = { treatment: empty(), control: empty() };
  let unreported = 0;
  let ignored = 0;
  for (const r of rows) {
    if (r.arm !== "treatment" && r.arm !== "control") continue;
    arms[r.arm] = { n: Number(r.n), sum: Number(r.total), variance: Number(r.spread), purchasers: Number(r.purchasers) };
    unreported += Number(r.unreported);
    ignored += Number(r.ignored);
  }
  return revenueReadout({ ...arms, unreportedConverters: unreported, invalidValues, ignoredOnNonConverters: ignored, alpha });
}
