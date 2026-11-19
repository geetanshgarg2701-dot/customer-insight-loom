/**
 * The learning ledger for public demo mode, plan sections 6.1 and 13.1:
 * kept in DuckDB-Wasm in the browser, persisted only through the export file.
 * Mirrors supabase/migrations, including the registration lock. Every value
 * from a person or a file goes through bound parameters.
 */
import { toPlainRow } from "../duckdb/normalize";
import type { SqlEngine, SqlParam } from "../intake/types";
import { assertReadoutOpen, conversionWindowHours } from "./window";

export const LEDGER_SCHEMA_VERSION = 1;

export const STATUSES = ["draft", "registered", "running", "readable", "closed"] as const;
export const FRAMEWORK_TAGS = ["PAS", "FAB", "AIDA"] as const;
/**
 * not_applied means one comparison, so there was nothing to correct. benjamini_hochberg is for a result where
 * benjaminiHochberg really was run across several comparisons. It was once written for every confirmatory result,
 * and results saved that way keep it, so it must stay a valid value on import.
 */
export const CORRECTION_METHODS = ["benjamini_hochberg", "exploratory_label", "not_applied"] as const;
export const ARMS = ["treatment", "control"] as const;
/** Tables a citation may point at in demo mode. More join as their tables arrive. */
export const CITABLE_TABLES = ["ledger_entries"] as const;
/**
 * Actor name for everything the demo seed does. An entry is synthetic when
 * this actor created it. Kept in the audit trail, so it survives export and import.
 */
export const SYNTHETIC_ACTOR = "synthetic_demo";

export type EntryStatus = (typeof STATUSES)[number];
export type FrameworkTag = (typeof FRAMEWORK_TAGS)[number];
export type CorrectionMethod = (typeof CORRECTION_METHODS)[number];
export type Arm = (typeof ARMS)[number];
export type Json = unknown;

export type LedgerEntry = {
  id: string;
  workspaceId: string;
  title: string;
  hypothesis: string;
  registeredAt: string | null;
  launchedAt: string | null;
  /** Computed: confirmatory when registered strictly before launch. Never stored. */
  entryType: "confirmatory" | "exploratory" | null;
  themeId: string | null;
  segmentId: string | null;
  journeyId: string | null;
  frameworkTag: FrameworkTag | null;
  design: Json | null;
  powerResult: Json | null;
  result: Json | null;
  comparisonsCount: number | null;
  correctionMethod: CorrectionMethod | null;
  status: EntryStatus;
  /** Imported entries carry times from a file, which this browser did not witness. */
  provenance: "local" | "imported";
  /** Generated demo data, which every screen must label as synthetic. */
  synthetic: boolean;
};

export type Citation = {
  id: string;
  entryId: string;
  citedRowTable: string;
  citedRowId: string;
  createdAt: string;
};

export type AuditRow = { id: number; entryId: string; actor: string; action: string; at: string };

/**
 * Results are append only. Version 1 is the first readout and is also kept on the
 * entry. Later versions never replace it, and each carries a reason.
 */
export type ResultVersion = {
  id: string;
  entryId: string;
  version: number;
  recordedAt: string;
  actor: string;
  reason: string;
  result: Json;
  comparisonsCount: number;
  correctionMethod: CorrectionMethod;
};

export const FIRST_READOUT_REASON = "first readout";

export type AssignmentRow = {
  entryId: string;
  customerEmailHash: string;
  arm: Arm;
  assignedAt: string;
};

export type DraftInput = {
  title: string;
  hypothesis: string;
  frameworkTag?: FrameworkTag | null;
  design?: Json | null;
  themeId?: string | null;
  segmentId?: string | null;
  journeyId?: string | null;
};

export type EntryPatch = Partial<DraftInput>;

export type LedgerOptions = {
  now?: () => Date;
  newId?: () => string;
  randomBytes?: (n: number) => Uint8Array;
  /** Used only when the store has no workspace yet. */
  workspaceId?: string;
};

export class LedgerLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerLockError";
  }
}

export class LedgerStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerStateError";
  }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const HASH_HEX = /^[0-9a-f]{64}$/;
export const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const EDITABLE = new Set(["title", "hypothesis", "frameworkTag", "design", "themeId", "segmentId", "journeyId"]);
/** The theme is locked too, so a test cannot be relabeled after the fact to fit an evidence chain. */
const LOCKED_ONCE_REGISTERED = new Set(["hypothesis", "design", "frameworkTag", "themeId"]);
const INSERT_CHUNK = 500;

export const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS ledger_meta (workspace_id VARCHAR NOT NULL, workspace_secret VARCHAR NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ledger_entries (
    id VARCHAR PRIMARY KEY, workspace_id VARCHAR NOT NULL, title VARCHAR NOT NULL, hypothesis VARCHAR NOT NULL,
    registered_at VARCHAR, launched_at VARCHAR, theme_id VARCHAR, segment_id VARCHAR, journey_id VARCHAR,
    framework_tag VARCHAR, design VARCHAR, power_result VARCHAR, result VARCHAR, comparisons_count INTEGER,
    correction_method VARCHAR, status VARCHAR NOT NULL, created_seq INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ledger_citations (
    id VARCHAR PRIMARY KEY, workspace_id VARCHAR NOT NULL, entry_id VARCHAR NOT NULL,
    cited_row_table VARCHAR NOT NULL, cited_row_id VARCHAR NOT NULL, created_at VARCHAR NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ledger_audit (
    id INTEGER PRIMARY KEY, workspace_id VARCHAR NOT NULL, entry_id VARCHAR NOT NULL,
    actor VARCHAR NOT NULL, action VARCHAR NOT NULL, "at" VARCHAR NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS assignments (
    workspace_id VARCHAR NOT NULL, entry_id VARCHAR NOT NULL, customer_email_hash VARCHAR NOT NULL,
    arm VARCHAR NOT NULL, assigned_at VARCHAR NOT NULL, PRIMARY KEY (entry_id, customer_email_hash))`,
  `CREATE TABLE IF NOT EXISTS ledger_result_versions (
    id VARCHAR PRIMARY KEY, workspace_id VARCHAR NOT NULL, entry_id VARCHAR NOT NULL, version INTEGER NOT NULL,
    recorded_at VARCHAR NOT NULL, actor VARCHAR NOT NULL, reason VARCHAR NOT NULL, result VARCHAR NOT NULL,
    comparisons_count INTEGER NOT NULL, correction_method VARCHAR NOT NULL, UNIQUE (entry_id, version))`,
];

const ENTRY_SELECT = `SELECT e.*,
  CASE WHEN e.registered_at IS NULL OR e.launched_at IS NULL THEN NULL
       WHEN e.registered_at < e.launched_at THEN 'confirmatory' ELSE 'exploratory' END AS entry_type,
  EXISTS (SELECT 1 FROM ledger_audit a WHERE a.entry_id = e.id AND a.action = 'imported') AS imported,
  EXISTS (SELECT 1 FROM ledger_audit a WHERE a.entry_id = e.id AND a.action = 'created'
          AND a.actor = '${SYNTHETIC_ACTOR}') AS synthetic
  FROM ledger_entries e`;

function parseJson(v: unknown): Json | null {
  return v === null || v === undefined ? null : JSON.parse(String(v));
}

function toJsonParam(v: Json | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const text = JSON.stringify(v);
  if (text === undefined) throw new RangeError("Design and result values must be plain JSON.");
  return text;
}

function str(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

function rowToEntry(raw: Record<string, unknown>): LedgerEntry {
  const r = toPlainRow(raw);
  return {
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    title: String(r.title),
    hypothesis: String(r.hypothesis),
    registeredAt: str(r.registered_at),
    launchedAt: str(r.launched_at),
    entryType: (r.entry_type as LedgerEntry["entryType"]) ?? null,
    themeId: str(r.theme_id),
    segmentId: str(r.segment_id),
    journeyId: str(r.journey_id),
    frameworkTag: (r.framework_tag as FrameworkTag | null) ?? null,
    design: parseJson(r.design),
    powerResult: parseJson(r.power_result),
    result: parseJson(r.result),
    comparisonsCount: r.comparisons_count === null ? null : Number(r.comparisons_count),
    correctionMethod: (r.correction_method as CorrectionMethod | null) ?? null,
    status: r.status as EntryStatus,
    provenance: r.imported ? "imported" : "local",
    synthetic: Boolean(r.synthetic),
  };
}

function checkText(v: unknown, label: string): string {
  if (typeof v !== "string" || v.trim() === "") throw new RangeError(`${label} must not be empty.`);
  return v;
}

function checkOptionalId(v: unknown, label: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string" || !UUID.test(v)) throw new RangeError(`${label} must be a UUID.`);
  return v;
}

function checkEnum<T extends string>(v: unknown, allowed: readonly T[], label: string): T | null {
  if (v === null || v === undefined) return null;
  if (!allowed.includes(v as T)) throw new RangeError(`${label} has a value that is not allowed.`);
  return v as T;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return hex(new Uint8Array(digest));
}

/** Runs fn inside one DuckDB transaction, rolling back on any error. */
export async function inTransaction<T>(engine: SqlEngine, fn: () => Promise<T>): Promise<T> {
  await engine.exec("BEGIN TRANSACTION");
  try {
    const out = await fn();
    await engine.exec("COMMIT");
    return out;
  } catch (error) {
    await engine.exec("ROLLBACK").catch(() => {});
    throw error;
  }
}

export async function ensureSchema(engine: SqlEngine): Promise<void> {
  for (const sql of SCHEMA_SQL) await engine.exec(sql);
}

/** Removes every ledger table. For tests and for a full reset of demo mode. */
export async function dropLedgerTables(engine: SqlEngine): Promise<void> {
  for (const t of [
    "ledger_result_versions",
    "assignments",
    "ledger_audit",
    "ledger_citations",
    "ledger_entries",
    "ledger_meta",
  ]) {
    await engine.exec(`DROP TABLE IF EXISTS ${t}`);
  }
}

/** Inserts rows in chunks through one multi row statement per chunk. */
export async function insertRows(
  engine: SqlEngine,
  table: string,
  columns: readonly string[],
  rows: readonly SqlParam[][],
): Promise<void> {
  const one = `(${columns.map(() => "?").join(", ")})`;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    await engine.query(
      `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(", ")}) VALUES ${chunk.map(() => one).join(", ")}`,
      chunk.flat(),
    );
  }
}

export interface Ledger {
  readonly workspaceId: string;
  /** The clock this ledger stamps with. Checks that gate on time use it, so they agree with the stamps. */
  now(): Date;
  createDraft(input: DraftInput, actor: string): Promise<LedgerEntry>;
  update(id: string, patch: EntryPatch, actor: string): Promise<LedgerEntry>;
  register(id: string, actor: string, extras?: { powerResult?: Json }): Promise<LedgerEntry>;
  /** Needs a conversion window in the design, so the readout knows when it may open. */
  launch(id: string, actor: string): Promise<LedgerEntry>;
  /**
   * Refused until the conversion window closes. The first call records the result.
   * Later calls add a numbered version and need a reason. Nothing is overwritten.
   */
  recordResult(
    id: string,
    input: { result: Json; comparisonsCount: number; correctionMethod: CorrectionMethod; reason?: string },
    actor: string,
  ): Promise<LedgerEntry>;
  listResults(entryId: string): Promise<ResultVersion[]>;
  close(id: string, actor: string): Promise<LedgerEntry>;
  getEntry(id: string): Promise<LedgerEntry>;
  listEntries(): Promise<LedgerEntry[]>;
  listAudit(entryId?: string): Promise<AuditRow[]>;
  addCitation(entryId: string, citedRowTable: string, citedRowId: string): Promise<Citation>;
  listCitations(): Promise<Citation[]>;
  recordAssignments(entryId: string, rows: { customerEmailHash: string; arm: Arm }[]): Promise<void>;
  listAssignments(entryId: string): Promise<AssignmentRow[]>;
  workspaceSecret(): Promise<string>;
  fingerprint(): Promise<{ entryCount: number; entryIdsHash: string }>;
  exportFile(): Promise<LedgerExportFile>;
}

export type LedgerExportFile = {
  schema_version: number;
  exported_at: string;
  workspace_id: string;
  workspace_secret: string;
  entries: Record<string, unknown>[];
  citations: Record<string, unknown>[];
  audit: Record<string, unknown>[];
  assignments: Record<string, unknown>[];
  /** Added after schema version 1 shipped. Optional on import, so older exports still load. */
  results: Record<string, unknown>[];
};

/** Opens the ledger in this store, creating its tables and workspace on first use. */
export async function createLedger(engine: SqlEngine, options: LedgerOptions = {}): Promise<Ledger> {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => crypto.randomUUID());
  const randomBytes =
    options.randomBytes ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)));

  await ensureSchema(engine);
  const meta = (await engine.all("SELECT workspace_id, workspace_secret FROM ledger_meta")).map(toPlainRow);
  let workspaceId: string;
  if (meta.length === 0) {
    workspaceId = options.workspaceId ?? newId();
    if (!UUID.test(workspaceId)) throw new RangeError("Workspace id must be a UUID.");
    await engine.query("INSERT INTO ledger_meta VALUES (?, ?)", [workspaceId, hex(randomBytes(32))]);
  } else {
    workspaceId = String(meta[0].workspace_id);
  }

  const stamp = () => now().toISOString();

  async function audit(entryId: string, actor: string, action: string): Promise<void> {
    const [next] = (await engine.all("SELECT coalesce(max(id), 0) + 1 AS n FROM ledger_audit")).map(toPlainRow);
    await engine.query("INSERT INTO ledger_audit VALUES (?, ?, ?, ?, ?, ?)", [
      Number(next.n),
      workspaceId,
      entryId,
      actor,
      action,
      stamp(),
    ]);
  }

  async function getEntry(id: string): Promise<LedgerEntry> {
    const rows = await engine.query(`${ENTRY_SELECT} WHERE e.id = ?`, [id]);
    if (rows.length === 0) throw new RangeError("Ledger entry not found.");
    return rowToEntry(rows[0]);
  }

  async function setColumns(id: string, values: Record<string, SqlParam>): Promise<void> {
    const keys = Object.keys(values);
    if (keys.length === 0) return;
    await engine.query(
      `UPDATE ledger_entries SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
      [...keys.map((k) => values[k]), id],
    );
  }

  function checkActor(actor: string) {
    checkText(actor, "Actor");
  }

  async function insertVersion(
    entryId: string,
    version: number,
    actor: string,
    reason: string,
    input: { result: Json; comparisonsCount: number },
    correction: CorrectionMethod,
  ): Promise<void> {
    await engine.query("INSERT INTO ledger_result_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
      newId(),
      workspaceId,
      entryId,
      version,
      stamp(),
      actor,
      reason,
      toJsonParam(input.result) ?? "null",
      input.comparisonsCount,
      correction,
    ]);
  }

  const ledger: Ledger = {
    workspaceId,

    now: () => now(),

    async createDraft(input, actor) {
      checkActor(actor);
      const title = checkText(input.title, "Title");
      const hypothesis = checkText(input.hypothesis, "Hypothesis");
      const frameworkTag = checkEnum(input.frameworkTag, FRAMEWORK_TAGS, "Framework tag");
      const themeId = checkOptionalId(input.themeId, "Theme id");
      const segmentId = checkOptionalId(input.segmentId, "Segment id");
      const journeyId = checkOptionalId(input.journeyId, "Journey id");
      const design = toJsonParam(input.design);
      const id = newId();
      const [seq] = (await engine.all("SELECT coalesce(max(created_seq), 0) + 1 AS n FROM ledger_entries")).map(
        toPlainRow,
      );
      await engine.query(
        `INSERT INTO ledger_entries (id, workspace_id, title, hypothesis, theme_id, segment_id, journey_id,
          framework_tag, design, status, created_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
        [id, workspaceId, title, hypothesis, themeId, segmentId, journeyId, frameworkTag, design, Number(seq.n)],
      );
      await audit(id, actor, "created");
      return getEntry(id);
    },

    async update(id, patch, actor) {
      checkActor(actor);
      const current = await getEntry(id);
      const values: Record<string, SqlParam> = {};
      for (const [key, value] of Object.entries(patch)) {
        if (!EDITABLE.has(key)) throw new RangeError(`The field ${key} cannot be edited.`);
        const before = current[key as keyof LedgerEntry];
        if (current.registeredAt !== null && LOCKED_ONCE_REGISTERED.has(key) && !sameJson(before, value)) {
          throw new LedgerLockError(`The ${key} is locked once an entry is registered.`);
        }
        if (key === "title") values.title = checkText(value, "Title");
        else if (key === "hypothesis") values.hypothesis = checkText(value, "Hypothesis");
        else if (key === "frameworkTag") values.framework_tag = checkEnum(value, FRAMEWORK_TAGS, "Framework tag");
        else if (key === "design") values.design = toJsonParam(value);
        else if (key === "themeId") values.theme_id = checkOptionalId(value, "Theme id");
        else if (key === "segmentId") values.segment_id = checkOptionalId(value, "Segment id");
        else if (key === "journeyId") values.journey_id = checkOptionalId(value, "Journey id");
      }
      await setColumns(id, values);
      await audit(id, actor, "updated");
      return getEntry(id);
    },

    async register(id, actor, extras) {
      checkActor(actor);
      const e = await getEntry(id);
      if (e.registeredAt !== null) throw new LedgerLockError("This entry is already registered.");
      if (e.status === "closed") throw new LedgerStateError("A closed entry cannot be registered.");
      const values: Record<string, SqlParam> = {
        registered_at: stamp(),
        status: e.status === "draft" ? "registered" : e.status,
      };
      if (extras?.powerResult !== undefined) values.power_result = toJsonParam(extras.powerResult);
      await setColumns(id, values);
      await audit(id, actor, "registered");
      return getEntry(id);
    },

    async launch(id, actor) {
      checkActor(actor);
      const e = await getEntry(id);
      if (e.launchedAt !== null) throw new LedgerLockError("This entry is already launched.");
      if (e.status !== "draft" && e.status !== "registered") {
        throw new LedgerStateError("Only a draft or registered entry can launch.");
      }
      if (conversionWindowHours(e.design) === null) {
        throw new LedgerStateError(
          "Set a conversion window in the design before launching, so the readout knows when it may open.",
        );
      }
      await setColumns(id, { launched_at: stamp(), status: "running" });
      await audit(id, actor, "launched");
      return getEntry(id);
    },

    async recordResult(id, input, actor) {
      checkActor(actor);
      if (!Number.isInteger(input.comparisonsCount) || input.comparisonsCount < 0) {
        throw new RangeError("Comparisons count must be a whole number >= 0.");
      }
      const correction = checkEnum(input.correctionMethod, CORRECTION_METHODS, "Correction method");
      if (correction === null) throw new RangeError("Correction method is required.");
      const e = await getEntry(id);
      if (e.launchedAt === null || (e.status !== "running" && e.status !== "readable")) {
        throw new LedgerStateError("A result can only be recorded for a launched, open entry.");
      }
      // The fixed horizon rule. Nothing below runs, and nothing is written, before the window closes.
      assertReadoutOpen(e, now());

      const [latest] = (
        await engine.query("SELECT coalesce(max(version), 0) AS v FROM ledger_result_versions WHERE entry_id = ?", [id])
      ).map(toPlainRow);
      const nextVersion = Number(latest.v) + 1;

      if (e.result === null) {
        await setColumns(id, {
          result: toJsonParam(input.result),
          comparisons_count: input.comparisonsCount,
          correction_method: correction,
          status: "readable",
        });
        await insertVersion(id, nextVersion, actor, FIRST_READOUT_REASON, input, correction);
        await audit(id, actor, "result_recorded");
      } else {
        const reason = typeof input.reason === "string" ? input.reason.trim() : "";
        if (reason === "") throw new RangeError("A new result version needs a reason.");
        await insertVersion(id, nextVersion, actor, reason, input, correction);
        await audit(id, actor, "result_version_recorded");
      }
      return getEntry(id);
    },

    async listResults(entryId) {
      return (
        await engine.query("SELECT * FROM ledger_result_versions WHERE entry_id = ? ORDER BY version", [entryId])
      )
        .map(toPlainRow)
        .map((r) => ({
          id: String(r.id),
          entryId: String(r.entry_id),
          version: Number(r.version),
          recordedAt: String(r.recorded_at),
          actor: String(r.actor),
          reason: String(r.reason),
          result: parseJson(r.result),
          comparisonsCount: Number(r.comparisons_count),
          correctionMethod: r.correction_method as CorrectionMethod,
        }));
    },

    async close(id, actor) {
      checkActor(actor);
      const e = await getEntry(id);
      if (e.status === "closed") throw new LedgerStateError("This entry is already closed.");
      await setColumns(id, { status: "closed" });
      await audit(id, actor, "closed");
      return getEntry(id);
    },

    getEntry,

    async listEntries() {
      return (await engine.all(`${ENTRY_SELECT} ORDER BY e.created_seq`)).map(rowToEntry);
    },

    async listAudit(entryId) {
      const rows =
        entryId === undefined
          ? await engine.all("SELECT * FROM ledger_audit ORDER BY id")
          : await engine.query("SELECT * FROM ledger_audit WHERE entry_id = ? ORDER BY id", [entryId]);
      return rows.map(toPlainRow).map((r) => ({
        id: Number(r.id),
        entryId: String(r.entry_id),
        actor: String(r.actor),
        action: String(r.action),
        at: String(r.at),
      }));
    },

    async addCitation(entryId, citedRowTable, citedRowId) {
      checkEnum(citedRowTable, CITABLE_TABLES, "Cited table");
      if (!UUID.test(citedRowId)) throw new RangeError("Cited row id must be a UUID.");
      await getEntry(entryId);
      const [hit] = (
        await engine.query("SELECT count(*) AS n FROM ledger_entries WHERE id = ?", [citedRowId])
      ).map(toPlainRow);
      if (Number(hit.n) === 0) throw new Error("The cited row does not exist.");
      const citation = { id: newId(), entryId, citedRowTable, citedRowId, createdAt: stamp() };
      await engine.query("INSERT INTO ledger_citations VALUES (?, ?, ?, ?, ?, ?)", [
        citation.id,
        workspaceId,
        entryId,
        citedRowTable,
        citedRowId,
        citation.createdAt,
      ]);
      return citation;
    },

    async listCitations() {
      return (await engine.all("SELECT * FROM ledger_citations ORDER BY created_at, id"))
        .map(toPlainRow)
        .map((r) => ({
          id: String(r.id),
          entryId: String(r.entry_id),
          citedRowTable: String(r.cited_row_table),
          citedRowId: String(r.cited_row_id),
          createdAt: String(r.created_at),
        }));
    },

    async recordAssignments(entryId, rows) {
      await getEntry(entryId);
      const seen = new Set<string>();
      for (const r of rows) {
        if (!HASH_HEX.test(r.customerEmailHash)) throw new RangeError("Customer hash must be 64 hex characters.");
        if (!ARMS.includes(r.arm)) throw new RangeError("Arm must be treatment or control.");
        if (seen.has(r.customerEmailHash)) throw new RangeError("The batch lists the same person twice.");
        seen.add(r.customerEmailHash);
      }
      const at = stamp();
      try {
        await inTransaction(engine, () =>
          insertRows(
            engine,
            "assignments",
            ["workspace_id", "entry_id", "customer_email_hash", "arm", "assigned_at"],
            rows.map((r) => [workspaceId, entryId, r.customerEmailHash, r.arm, at]),
          ),
        );
      } catch (error) {
        if (/constraint|duplicate|primary key/i.test(String(error))) {
          throw new Error("Someone in this batch is already assigned for this entry. Assignments cannot change.");
        }
        throw error;
      }
    },

    async listAssignments(entryId) {
      return (
        await engine.query("SELECT * FROM assignments WHERE entry_id = ? ORDER BY rowid", [entryId])
      )
        .map(toPlainRow)
        .map((r) => ({
          entryId: String(r.entry_id),
          customerEmailHash: String(r.customer_email_hash),
          arm: r.arm as Arm,
          assignedAt: String(r.assigned_at),
        }));
    },

    async workspaceSecret() {
      const [m] = (await engine.all("SELECT workspace_secret FROM ledger_meta")).map(toPlainRow);
      return String(m.workspace_secret);
    },

    async fingerprint() {
      const ids = (await engine.all("SELECT id FROM ledger_entries")).map((r) => String(toPlainRow(r).id)).sort();
      return { entryCount: ids.length, entryIdsHash: await sha256Hex(ids.join("\n")) };
    },

    async exportFile() {
      const entries = (await engine.all("SELECT * FROM ledger_entries ORDER BY created_seq"))
        .map(toPlainRow)
        .map((r) => ({
          id: r.id,
          title: r.title,
          hypothesis: r.hypothesis,
          registered_at: r.registered_at,
          launched_at: r.launched_at,
          theme_id: r.theme_id,
          segment_id: r.segment_id,
          journey_id: r.journey_id,
          framework_tag: r.framework_tag,
          design: parseJson(r.design),
          power_result: parseJson(r.power_result),
          result: parseJson(r.result),
          comparisons_count: r.comparisons_count === null ? null : Number(r.comparisons_count),
          correction_method: r.correction_method,
          status: r.status,
        }));
      const citations = (await engine.all("SELECT * FROM ledger_citations ORDER BY created_at, id"))
        .map(toPlainRow)
        .map((r) => ({
          id: r.id,
          entry_id: r.entry_id,
          cited_row_table: r.cited_row_table,
          cited_row_id: r.cited_row_id,
          created_at: r.created_at,
        }));
      const auditRows = (await engine.all("SELECT * FROM ledger_audit ORDER BY id"))
        .map(toPlainRow)
        .map((r) => ({ id: Number(r.id), entry_id: r.entry_id, actor: r.actor, action: r.action, at: r.at }));
      const assignments = (await engine.all("SELECT * FROM assignments ORDER BY rowid"))
        .map(toPlainRow)
        .map((r) => ({
          entry_id: r.entry_id,
          customer_email_hash: r.customer_email_hash,
          arm: r.arm,
          assigned_at: r.assigned_at,
        }));
      const results = (await engine.all("SELECT * FROM ledger_result_versions ORDER BY entry_id, version"))
        .map(toPlainRow)
        .map((r) => ({
          id: r.id,
          entry_id: r.entry_id,
          version: Number(r.version),
          recorded_at: r.recorded_at,
          actor: r.actor,
          reason: r.reason,
          result: parseJson(r.result),
          comparisons_count: Number(r.comparisons_count),
          correction_method: r.correction_method,
        }));
      return {
        schema_version: LEDGER_SCHEMA_VERSION,
        exported_at: stamp(),
        workspace_id: workspaceId,
        workspace_secret: await ledger.workspaceSecret(),
        entries,
        citations,
        audit: auditRows,
        assignments,
        results,
      };
    },
  };
  return ledger;
}
