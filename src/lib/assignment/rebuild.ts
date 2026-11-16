/**
 * Rebuilds the assignment download from a re-uploaded audience file, because
 * the app does not keep emails and so cannot remake the file by itself.
 *
 * Every group comes from the stored assignment, never from a new draw.
 * The hash is also recomputed as a check: a person whose recomputed group
 * differs from the stored one is left out and counted, because that means the
 * secret or the share changed. People who were never assigned are left out,
 * so a different file cannot add anyone. Nothing new is stored.
 */
import type { Arm, Ledger } from "../ledger/ledger";
import { shareToThreshold, type AssignedRow } from "./assign";
import { bucketOf, customerHash, looksLikeEmail, normalizeEmail } from "./hash";

const HASH_BATCH = 1000;

export type RebuildResult = {
  /** For the download only. Held in memory, never stored. */
  rows: AssignedRow[];
  matched: number;
  /** People in the file who were never assigned to this entry. */
  unknown: number;
  /** Assigned people who are not in the file. */
  missing: number;
  duplicates: number;
  invalid: number;
  /** Stored groups the hash no longer reproduces. */
  inconsistent: number;
};

export async function rebuildAssignment(input: {
  ledger: Ledger;
  entryId: string;
  emails: readonly (string | null)[];
  treatmentShare: number;
}): Promise<RebuildResult> {
  const { ledger, entryId } = input;
  const threshold = shareToThreshold(input.treatmentShare);
  const stored = new Map<string, Arm>(
    (await ledger.listAssignments(entryId)).map((a) => [a.customerEmailHash, a.arm]),
  );
  if (stored.size === 0) throw new Error("This entry has no assignment yet, so there is nothing to rebuild.");
  const secret = await ledger.workspaceSecret();

  let invalid = 0;
  const valid: string[] = [];
  for (const raw of input.emails) {
    const email = raw === null ? "" : normalizeEmail(raw);
    if (looksLikeEmail(email)) valid.push(email);
    else invalid++;
  }

  const seen = new Set<string>();
  const rows: AssignedRow[] = [];
  let duplicates = 0;
  let unknown = 0;
  let inconsistent = 0;
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
      const arm = stored.get(h);
      if (arm === undefined) {
        unknown++;
        return;
      }
      const recomputed: Arm = buckets[j] < threshold ? "treatment" : "control";
      if (recomputed !== arm) {
        inconsistent++;
        return;
      }
      rows.push({ email, arm });
    });
  }

  let present = 0;
  for (const h of seen) if (stored.has(h)) present++;
  return {
    rows,
    matched: rows.length,
    unknown,
    missing: stored.size - present,
    duplicates,
    invalid,
    inconsistent,
  };
}
