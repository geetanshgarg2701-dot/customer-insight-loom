import type { EntryStatus, FrameworkTag, LedgerEntry } from "./ledger";

/** What to show in the ledger list. Every part is optional, and all of them must match, so choosing more narrows it. */
export type EntryFilter = {
  status: EntryStatus | "all";
  /** "none" finds entries whose type is not set yet, such as a draft. */
  type: "all" | "confirmatory" | "exploratory" | "none";
  /** "none" finds entries with no framework tag. */
  tag: FrameworkTag | "all" | "none";
  /** Plain text, matched against the title and the hypothesis, ignoring case. */
  text: string;
};

export const NO_FILTER: EntryFilter = { status: "all", type: "all", tag: "all", text: "" };

export function filterEntries(entries: readonly LedgerEntry[], filter: EntryFilter): LedgerEntry[] {
  const needle = filter.text.trim().toLowerCase();
  return entries.filter((e) => {
    if (filter.status !== "all" && e.status !== filter.status) return false;
    if (filter.type !== "all" && (e.entryType ?? "none") !== filter.type) return false;
    if (filter.tag !== "all" && (e.frameworkTag ?? "none") !== filter.tag) return false;
    // A plain substring test, never a pattern, so a character such as a bracket cannot mean something else.
    if (needle !== "" && !`${e.title}\n${e.hypothesis}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}
