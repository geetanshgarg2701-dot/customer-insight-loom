/**
 * What this tab is holding, and how to clear it. Plan section 13.3 asks for a usage meter that warns at about 80 percent
 * of any limit the app can measure, a delete all control, and a nudge to export. The plan wrote those for pilot mode on
 * Supabase, which is not built. In the browser app the one real limit the app can read is DuckDB's own memory limit, so
 * the meter measures memory use against it, and delete all drops every table and view in the in-browser database.
 *
 * Nothing here is stored. The last export time lives in this module's memory and goes when the page does, like the
 * ledger itself.
 */
import { toPlainRow } from "../duckdb/normalize";
import type { SqlEngine } from "../intake/types";

export const WARN_AT = 0.8;
export const EXPORT_NAG_DAYS = 14;

const UNITS: Readonly<Record<string, number>> = {
  bytes: 1,
  byte: 1,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
  kb: 1000,
  mb: 1000 ** 2,
  gb: 1000 ** 3,
  tb: 1000 ** 4,
};

/** Reads a size as DuckDB prints it, such as "3.1 GiB" or "0 bytes". */
export function parseBytes(text: string): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([A-Za-z]+)\s*$/.exec(text);
  const unit = m ? UNITS[m[2].toLowerCase()] : undefined;
  if (!m || unit === undefined) throw new RangeError("That is not a size.");
  return Math.round(Number(m[1]) * unit);
}

export type MeterLevel = "ok" | "warn" | "full";

/** Memory in use as a share of its limit: ok below 80 percent, warn from 80 percent, full from 100 percent. */
export function meterLevel(used: number, limit: number): { fraction: number; level: MeterLevel } {
  if (!Number.isFinite(used) || used < 0) throw new RangeError("Memory in use must be a number of bytes, 0 or more.");
  if (!Number.isFinite(limit) || limit <= 0) throw new RangeError("The memory limit must be a number of bytes above 0.");
  const fraction = used / limit;
  return { fraction, level: fraction >= 1 ? "full" : fraction >= WARN_AT ? "warn" : "ok" };
}

/** A nudge to export, or null. Counts only what this tab has done, since nothing is kept between page loads. */
export function exportNag(lastExportMs: number | null, nowMs: number, entryCount: number): string | null {
  if (entryCount <= 0) return null;
  const entries = `${entryCount} ${entryCount === 1 ? "entry" : "entries"}`;
  if (lastExportMs === null) return `This ledger has ${entries} and has not been exported from this tab. A page reload empties it.`;
  const days = Math.floor((nowMs - lastExportMs) / 86_400_000);
  if (days <= EXPORT_NAG_DAYS) return null;
  return `The last export from this tab was ${days} days ago, and the ledger has ${entries}. Export again to keep any changes.`;
}

let lastExport: number | null = null;
/** Called when the ledger file is exported, so the nudge can say when. Held in memory only. */
export function noteExport(nowMs: number): void {
  lastExport = nowMs;
}
export function lastExportTime(): number | null {
  return lastExport;
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

export type Usage = {
  usedBytes: number;
  limitBytes: number;
  fraction: number;
  level: MeterLevel;
  tables: { name: string; rows: number }[];
};

export async function readUsage(engine: SqlEngine): Promise<Usage> {
  const [limit] = (await engine.all("SELECT current_setting('memory_limit') AS v")).map(toPlainRow);
  const [used] = (await engine.all("SELECT COALESCE(sum(memory_usage_bytes), 0) AS n FROM duckdb_memory()")).map(toPlainRow);
  const names = (await engine.all("SELECT table_name FROM duckdb_tables() WHERE NOT internal")).map((r) => String(toPlainRow(r).table_name));
  const tables: Usage["tables"] = [];
  for (const name of names) {
    const [row] = (await engine.all(`SELECT count(*) AS n FROM ${quote(name)}`)).map(toPlainRow);
    tables.push({ name, rows: Number(row.n) });
  }
  tables.sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name));
  const usedBytes = Number(used.n);
  const limitBytes = parseBytes(String(limit.v));
  return { usedBytes, limitBytes, ...meterLevel(usedBytes, limitBytes), tables };
}

/** Drops every table and view the app made, and checks that none is left. Returns what it removed. */
export async function deleteEverything(engine: SqlEngine): Promise<{ tables: number; views: number; rows: number }> {
  const usage = await readUsage(engine);
  const views = (await engine.all("SELECT view_name FROM duckdb_views() WHERE NOT internal")).map((r) => String(toPlainRow(r).view_name));
  for (const v of views) await engine.exec(`DROP VIEW IF EXISTS ${quote(v)}`);
  for (const t of usage.tables) await engine.exec(`DROP TABLE IF EXISTS ${quote(t.name)}`);
  const left = await readUsage(engine);
  const leftViews = (await engine.all("SELECT count(*) AS n FROM duckdb_views() WHERE NOT internal")).map(toPlainRow)[0];
  if (left.tables.length > 0 || Number(leftViews.n) > 0) throw new Error("Some data was not deleted. Reload the page to clear it.");
  return { tables: usage.tables.length, views: views.length, rows: usage.tables.reduce((n, t) => n + t.rows, 0) };
}
