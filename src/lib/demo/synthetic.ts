/**
 * Synthetic people and outcomes for the public demo. Every address uses the
 * reserved .invalid domain from RFC 2606, so it can never reach a real person.
 * Outcomes come from a seeded generator with a known true lift, so the screen
 * can say where the readout should land.
 */
import { csvCell } from "../assignment/assign";
import { customerHash } from "../assignment/hash";
import type { Arm, Ledger } from "../ledger/ledger";
import { mulberry32 } from "../stats/honesty";

export const DEMO_DOMAIN = "example.invalid";
export const DEMO_POOL_SIZE = 12_000;
const HASH_BATCH = 1000;

export function demoEmail(i: number): string {
  return `demo.person${i}@${DEMO_DOMAIN}`;
}

function toCsv(header: string[], rows: string[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** An audience file a visitor can upload to try assignment. */
export function demoAudienceCsv(n = 5000): string {
  if (!Number.isInteger(n) || n < 1 || n > DEMO_POOL_SIZE) {
    throw new RangeError(`A demo audience has 1 to ${DEMO_POOL_SIZE} people.`);
  }
  const segments = ["new", "returning", "lapsed"];
  const rows = Array.from({ length: n }, (_, i) => [demoEmail(i), segments[i % 3], `2026-W${String((i % 40) + 1).padStart(2, "0")}`]);
  return toCsv(["email", "segment", "signup_week"], rows);
}

export type DemoResultRow = { email: string; group: Arm; converted: string };

/**
 * A results file for the demo people assigned to an entry. Treatment converts
 * at baseline plus the true lift, control at the baseline. pendingShare leaves
 * that share of windows open, written as a blank converted value.
 */
export async function demoResultRows(input: {
  ledger: Ledger;
  entryId: string;
  baselineRate: number;
  trueLift: number;
  seed: number;
  pendingShare?: number;
}): Promise<{ rows: DemoResultRow[]; matched: number }> {
  const { ledger, entryId, baselineRate, trueLift, seed } = input;
  const pendingShare = input.pendingShare ?? 0;
  const treated = baselineRate + trueLift;
  if (!(baselineRate >= 0 && baselineRate <= 1 && treated >= 0 && treated <= 1)) {
    throw new RangeError("Baseline and baseline plus lift must both be between 0 and 1.");
  }
  if (!(pendingShare >= 0 && pendingShare < 1)) throw new RangeError("Pending share must be from 0 to below 1.");

  const secret = await ledger.workspaceSecret();
  const stored = new Map((await ledger.listAssignments(entryId)).map((a) => [a.customerEmailHash, a.arm]));
  const rng = mulberry32(seed);
  const rows: DemoResultRow[] = [];
  for (let start = 0; start < DEMO_POOL_SIZE && stored.size > 0; start += HASH_BATCH) {
    const emails = Array.from({ length: Math.min(HASH_BATCH, DEMO_POOL_SIZE - start) }, (_, j) => demoEmail(start + j));
    const hashes = await Promise.all(emails.map((e) => customerHash(secret, e)));
    emails.forEach((email, j) => {
      const arm = stored.get(hashes[j]);
      if (!arm) return;
      // Two draws per person in a fixed order, so the file is the same every time.
      const open = rng() < pendingShare;
      const converted = rng() < (arm === "treatment" ? treated : baselineRate);
      rows.push({ email, group: arm, converted: open ? "" : converted ? "1" : "0" });
    });
  }
  return { rows, matched: rows.length };
}

export function demoResultsCsv(rows: readonly DemoResultRow[]): string {
  return toCsv(
    ["email", "group", "converted"],
    rows.map((r) => [r.email, r.group, r.converted]),
  );
}

/** A stable numeric seed from an entry id, so each entry gets its own fixed demo outcomes. */
export function seedFromId(id: string): number {
  return parseInt(id.replace(/-/g, "").slice(0, 8), 16) >>> 0;
}
