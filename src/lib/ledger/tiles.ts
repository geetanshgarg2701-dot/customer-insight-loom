import type { EntryStatus } from "./ledger";

/**
 * The number tiles at the top of the ledger screen. Every entry is counted in exactly one place, by where it stands, so
 * the three groups always add up to the total. Nothing here ranks the experiments or counts wins: a count of significant
 * results invites reading the list as a scoreboard, and the ledger already says what a list of results can and cannot show.
 */
export type LedgerTiles = {
  entries: number;
  /** Written down, not yet registered. */
  drafts: number;
  /** Registered or running: the bet is recorded and the conversion window has not closed. */
  underway: number;
  /** Ready to read, or closed with a result recorded. */
  finished: number;
};

export function ledgerTiles(entries: readonly { status: EntryStatus }[]): LedgerTiles {
  let drafts = 0;
  let underway = 0;
  let finished = 0;
  for (const e of entries) {
    if (e.status === "draft") drafts++;
    else if (e.status === "registered" || e.status === "running") underway++;
    else finished++;
  }
  return { entries: entries.length, drafts, underway, finished };
}
