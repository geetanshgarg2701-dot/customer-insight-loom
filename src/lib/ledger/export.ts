/**
 * Ledger import, plan section 6.1. The file is validated in full before
 * anything is written, then inserted in one transaction under the importing
 * workspace's id. Messages never repeat text from the file.
 *
 * Known limit: an export file can be edited by hand, so registration and
 * launch times in an imported file are only as trustworthy as the file.
 * Imported entries are marked so the screen can say that.
 */
import { toPlainRow } from "../duckdb/normalize";
import type { SqlEngine, SqlParam } from "../intake/types";
import {
  ARMS,
  CITABLE_TABLES,
  CORRECTION_METHODS,
  FRAMEWORK_TAGS,
  HASH_HEX,
  ISO_UTC,
  LEDGER_SCHEMA_VERSION,
  STATUSES,
  UUID,
  createLedger,
  ensureSchema,
  inTransaction,
  insertRows,
  type Ledger,
  type LedgerOptions,
} from "./ledger";

export { LEDGER_SCHEMA_VERSION };

export class LedgerImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerImportError";
  }
}

type Obj = Record<string, unknown>;

function fail(message: string): never {
  throw new LedgerImportError(message);
}

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isTime(v: unknown): boolean {
  return typeof v === "string" && ISO_UTC.test(v) && !Number.isNaN(Date.parse(v));
}

function isText(v: unknown): boolean {
  return typeof v === "string" && v.trim() !== "";
}

function optionalId(v: unknown): boolean {
  return v === null || (typeof v === "string" && UUID.test(v));
}

function oneOf(v: unknown, allowed: readonly string[], nullable: boolean): boolean {
  return (nullable && v === null) || (typeof v === "string" && allowed.includes(v));
}

function list(file: Obj, key: string): Obj[] {
  const v = file[key];
  if (!Array.isArray(v)) fail(`The file is missing its ${key} list.`);
  v.forEach((item, i) => {
    if (!isObj(item)) fail(`Item ${i + 1} in the ${key} list is not a record.`);
  });
  return v as Obj[];
}

type Validated = {
  secret: string;
  entries: Obj[];
  citations: Obj[];
  audit: Obj[];
  assignments: Obj[];
  results: Obj[];
};

/** Checks every rule before anything is written. */
export function validateExport(file: unknown): Validated {
  if (!isObj(file)) fail("This file is not a ledger export.");
  const version = file.schema_version;
  if (typeof version !== "number") fail("This file is not a ledger export.");
  if (version !== LEDGER_SCHEMA_VERSION) {
    fail(
      `This file is ledger schema version ${Number.isFinite(version) ? version : "unknown"}. ` +
        `This app reads version ${LEDGER_SCHEMA_VERSION}.`,
    );
  }
  if (typeof file.workspace_secret !== "string" || !HASH_HEX.test(file.workspace_secret)) {
    fail("The file is missing its workspace secret.");
  }
  const entries = list(file, "entries");
  const citations = list(file, "citations");
  const audit = list(file, "audit");
  const assignments = list(file, "assignments");
  // Result versions were added after the first exports, so an older file may not have the list.
  const results = file.results === undefined ? [] : list(file, "results");

  const ids = new Set<string>();
  entries.forEach((e, i) => {
    const n = `Entry ${i + 1}`;
    if (typeof e.id !== "string" || !UUID.test(e.id)) fail(`${n} has an invalid id.`);
    if (ids.has(e.id)) fail("The file has a duplicate entry id.");
    ids.add(e.id);
    if (!isText(e.title) || !isText(e.hypothesis)) fail(`${n} is missing its title or hypothesis.`);
    for (const k of ["registered_at", "launched_at"]) {
      if (e[k] !== null && !isTime(e[k])) fail(`${n} has an invalid time.`);
    }
    for (const k of ["theme_id", "segment_id", "journey_id"]) {
      if (!optionalId(e[k])) fail(`${n} has an invalid linked id.`);
    }
    if (!oneOf(e.status, STATUSES, false)) fail(`${n} has an invalid status.`);
    if (!oneOf(e.framework_tag, FRAMEWORK_TAGS, true)) fail(`${n} has an invalid framework tag.`);
    if (!oneOf(e.correction_method, CORRECTION_METHODS, true)) fail(`${n} has an invalid correction method.`);
    const count = e.comparisons_count;
    if (count !== null && !(Number.isInteger(count) && (count as number) >= 0)) {
      fail(`${n} has an invalid comparisons count.`);
    }
    for (const k of ["design", "power_result", "result"]) {
      if (!(k in e)) fail(`${n} is missing a field.`);
    }
    // The same rules the ledger enforces when it changes state.
    if (e.status === "draft" && (e.registered_at !== null || e.launched_at !== null)) {
      fail(`${n} is a draft but has a registration or launch time.`);
    }
    if (e.status === "registered" && e.registered_at === null) {
      fail(`${n} is registered but has no registration time.`);
    }
    if (["running", "readable"].includes(e.status as string) && e.launched_at === null) {
      fail(`${n} is marked launched but has no launch time.`);
    }
  });

  const citationIds = new Set<string>();
  citations.forEach((c, i) => {
    const n = `Citation ${i + 1}`;
    if (typeof c.id !== "string" || !UUID.test(c.id)) fail(`${n} has an invalid id.`);
    if (citationIds.has(c.id)) fail("The file has a duplicate citation id.");
    citationIds.add(c.id);
    if (typeof c.entry_id !== "string" || !ids.has(c.entry_id)) fail("A citation points at a missing entry.");
    if (!oneOf(c.cited_row_table, CITABLE_TABLES, false)) fail(`${n} cites a table that is not allowed.`);
    if (typeof c.cited_row_id !== "string" || !ids.has(c.cited_row_id)) {
      fail("A citation points at a missing entry.");
    }
    if (!isTime(c.created_at)) fail(`${n} has an invalid time.`);
  });

  const auditIds = new Set<number>();
  audit.forEach((a, i) => {
    const n = `Audit row ${i + 1}`;
    if (!Number.isInteger(a.id) || (a.id as number) < 1) fail(`${n} has an invalid id.`);
    if (auditIds.has(a.id as number)) fail("The file has a duplicate audit id.");
    auditIds.add(a.id as number);
    if (typeof a.entry_id !== "string" || !ids.has(a.entry_id)) fail("An audit row points at a missing entry.");
    if (!isText(a.actor) || !isText(a.action)) fail(`${n} is missing its actor or action.`);
    if (!isTime(a.at)) fail(`${n} has an invalid time.`);
  });

  const assignmentKeys = new Set<string>();
  assignments.forEach((a, i) => {
    const n = `Assignment ${i + 1}`;
    if (typeof a.entry_id !== "string" || !ids.has(a.entry_id)) fail("An assignment points at a missing entry.");
    if (typeof a.customer_email_hash !== "string" || !HASH_HEX.test(a.customer_email_hash)) {
      fail(`${n} has an invalid customer hash.`);
    }
    const key = `${a.entry_id}:${a.customer_email_hash}`;
    if (assignmentKeys.has(key)) fail("The file has a duplicate assignment.");
    assignmentKeys.add(key);
    if (!oneOf(a.arm, ARMS, false)) fail(`${n} has an invalid arm.`);
    if (!isTime(a.assigned_at)) fail(`${n} has an invalid time.`);
  });

  const resultIds = new Set<string>();
  const versionKeys = new Set<string>();
  results.forEach((r, i) => {
    const n = `Result version ${i + 1}`;
    if (typeof r.id !== "string" || !UUID.test(r.id)) fail(`${n} has an invalid id.`);
    if (resultIds.has(r.id)) fail("The file has a duplicate result version id.");
    resultIds.add(r.id);
    if (typeof r.entry_id !== "string" || !ids.has(r.entry_id)) fail("A result version points at a missing entry.");
    if (!Number.isInteger(r.version) || (r.version as number) < 1) fail(`${n} has an invalid version number.`);
    const key = `${r.entry_id}:${r.version}`;
    if (versionKeys.has(key)) fail("The file has a duplicate result version.");
    versionKeys.add(key);
    if (!isTime(r.recorded_at)) fail(`${n} has an invalid time.`);
    if (!isText(r.actor) || !isText(r.reason)) fail(`${n} is missing its actor or reason.`);
    if (!("result" in r) || r.result === undefined) fail(`${n} is missing its result.`);
    if (!Number.isInteger(r.comparisons_count) || (r.comparisons_count as number) < 0) {
      fail(`${n} has an invalid comparisons count.`);
    }
    if (!oneOf(r.correction_method, CORRECTION_METHODS, false)) fail(`${n} has an invalid correction method.`);
  });

  return { secret: file.workspace_secret, entries, citations, audit, assignments, results };
}

function json(v: unknown): string | null {
  return v === null || v === undefined ? null : JSON.stringify(v);
}

/**
 * Imports an export file into an empty ledger and returns that ledger.
 * Ids are kept, so the plan's round trip hash of sorted entry ids matches.
 */
export async function importLedger(
  engine: SqlEngine,
  file: unknown,
  options: LedgerOptions,
): Promise<Ledger> {
  const v = validateExport(file);

  await ensureSchema(engine);
  const [existing] = (await engine.all("SELECT count(*) AS n FROM ledger_entries")).map(toPlainRow);
  if (Number(existing.n) > 0) {
    throw new LedgerImportError("Import goes into an empty ledger. This ledger already has entries.");
  }

  // Opening the ledger creates the importing workspace if there is none yet.
  const target = await createLedger(engine, options);
  const ws = target.workspaceId;
  const now = (options.now ?? (() => new Date()))().toISOString();

  try {
    await inTransaction(engine, async () => {
      await engine.query("UPDATE ledger_meta SET workspace_secret = ?", [v.secret]);
      await insertRows(
        engine,
        "ledger_entries",
        [
          "id", "workspace_id", "title", "hypothesis", "registered_at", "launched_at", "theme_id",
          "segment_id", "journey_id", "framework_tag", "design", "power_result", "result",
          "comparisons_count", "correction_method", "status", "created_seq",
        ],
        v.entries.map((e, i): SqlParam[] => [
          e.id as string, ws, e.title as string, e.hypothesis as string,
          e.registered_at as string | null, e.launched_at as string | null,
          e.theme_id as string | null, e.segment_id as string | null, e.journey_id as string | null,
          e.framework_tag as string | null, json(e.design), json(e.power_result), json(e.result),
          e.comparisons_count as number | null, e.correction_method as string | null,
          e.status as string, i + 1,
        ]),
      );
      await insertRows(
        engine,
        "ledger_citations",
        ["id", "workspace_id", "entry_id", "cited_row_table", "cited_row_id", "created_at"],
        v.citations.map((c): SqlParam[] => [
          c.id as string, ws, c.entry_id as string, c.cited_row_table as string,
          c.cited_row_id as string, c.created_at as string,
        ]),
      );
      // Audit ids are renumbered in file order, then one imported row per entry is appended.
      const auditRows: SqlParam[][] = v.audit
        .slice()
        .sort((a, b) => (a.id as number) - (b.id as number))
        .map((a, i) => [i + 1, ws, a.entry_id as string, a.actor as string, a.action as string, a.at as string]);
      v.entries.forEach((e) => {
        auditRows.push([auditRows.length + 1, ws, e.id as string, "import", "imported", now]);
      });
      await insertRows(engine, "ledger_audit", ["id", "workspace_id", "entry_id", "actor", "action", "at"], auditRows);
      await insertRows(
        engine,
        "assignments",
        ["workspace_id", "entry_id", "customer_email_hash", "arm", "assigned_at"],
        v.assignments.map((a): SqlParam[] => [
          ws, a.entry_id as string, a.customer_email_hash as string, a.arm as string, a.assigned_at as string,
        ]),
      );

      // Every recorded result keeps a version 1. An export from before versions existed has none, so
      // one is made from the entry's own result, and its reason says so.
      const newId = options.newId ?? (() => crypto.randomUUID());
      const withVersions = new Set(v.results.map((r) => r.entry_id as string));
      const versionRows: SqlParam[][] = v.results.map((r): SqlParam[] => [
        r.id as string, ws, r.entry_id as string, r.version as number, r.recorded_at as string,
        r.actor as string, r.reason as string, JSON.stringify(r.result), r.comparisons_count as number,
        r.correction_method as string,
      ]);
      for (const e of v.entries) {
        if (e.result === null || withVersions.has(e.id as string)) continue;
        versionRows.push([
          newId(), ws, e.id as string, 1, (e.launched_at as string | null) ?? now, "import",
          "first readout, added on import from an export that had no versions", JSON.stringify(e.result),
          (e.comparisons_count as number | null) ?? 0, (e.correction_method as string | null) ?? "exploratory_label",
        ]);
      }
      await insertRows(
        engine,
        "ledger_result_versions",
        [
          "id", "workspace_id", "entry_id", "version", "recorded_at", "actor", "reason", "result",
          "comparisons_count", "correction_method",
        ],
        versionRows,
      );
    });
  } catch {
    throw new LedgerImportError("The import failed and nothing was saved.");
  }
  return target;
}
