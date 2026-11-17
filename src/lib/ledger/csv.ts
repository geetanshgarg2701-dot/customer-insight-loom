import { csvLine } from "../app/csv";
import type { LedgerEntry } from "./ledger";

/**
 * The ledger as a CSV file, one row per entry, for a spreadsheet. It holds the entry, its status and its first result, in
 * the numbers the statistics code worked out. It leaves out the design, the workspace and every assignment, so no
 * address, hash or secret can be in it. A title or a hypothesis that starts like a formula is protected by csvCell.
 */

export const LEDGER_CSV_COLUMNS = [
  "id",
  "title",
  "hypothesis",
  "status",
  "entry_type",
  "framework_tag",
  "registered_at",
  "launched_at",
  "source",
  "comparisons_count",
  "correction_method",
  "result_versions",
  "lift",
  "interval_low",
  "interval_high",
  "significant",
  "p_value",
  "treatment_rate",
  "control_rate",
  "n_treatment",
  "n_control",
  "engine_version",
] as const;

type Bag = Record<string, unknown>;

const isBag = (v: unknown): v is Bag => typeof v === "object" && v !== null && !Array.isArray(v);

/** A finite number as written by the code that made it, or an empty cell. */
const num = (v: unknown): string => (typeof v === "number" && Number.isFinite(v) ? String(v) : "");

function sourceOf(e: LedgerEntry): string {
  if (e.synthetic) return "synthetic demo";
  return e.provenance === "imported" ? "imported, times not verified" : "this browser";
}

/** @param versionCounts how many result versions each entry has, by entry id. */
export function ledgerCsv(entries: readonly LedgerEntry[], versionCounts: ReadonlyMap<string, number>): string {
  const lines = [csvLine([...LEDGER_CSV_COLUMNS])];
  for (const e of entries) {
    const r: Bag = isBag(e.result) ? e.result : {};
    const sizes: Bag = isBag(r.sample_sizes) ? r.sample_sizes : {};
    lines.push(
      csvLine([
        e.id,
        e.title,
        e.hypothesis,
        e.status,
        e.entryType ?? "not set",
        e.frameworkTag ?? "",
        e.registeredAt ?? "",
        e.launchedAt ?? "",
        sourceOf(e),
        e.comparisonsCount === null ? "" : String(e.comparisonsCount),
        e.correctionMethod ?? "",
        String(versionCounts.get(e.id) ?? 0),
        num(r.lift),
        num(r.interval_low),
        num(r.interval_high),
        typeof r.significant === "boolean" ? String(r.significant) : "",
        num(r.p_value),
        num(r.treatment_rate),
        num(r.control_rate),
        num(sizes.treatment),
        num(sizes.control),
        typeof r.engine_version === "string" ? r.engine_version : "",
      ]),
    );
  }
  return lines.join("");
}
