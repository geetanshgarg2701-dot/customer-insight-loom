import { toPlainRow } from "../duckdb/normalize";
import type { SqlEngine } from "../intake/types";
import { deliverySummary, type Delivery } from "./delivery";
import { readout, type Readout } from "./readout";
import { sampleRatioCheck, type SrmResult } from "./srm";

export type ArmTally = {
  /** Everyone assigned to the arm. The mismatch check uses this. */
  assigned: number;
  /** People whose conversion window has closed. The readout uses this. */
  n: number;
  conversions: number;
  /** People whose window is still open, shown separately and excluded, plan section 6.2. */
  pending: number;
};

export type ArmCounts = { treatment: ArmTally; control: ArmTally };

const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;
const ARMS = new Set(["treatment", "control"]);

/**
 * Counts per arm, computed in DuckDB. The table needs an `arm` column holding
 * treatment or control, and a boolean `converted` column that is NULL while a
 * person's conversion window is still open.
 */
export async function armCounts(engine: SqlEngine, table: string): Promise<ArmCounts> {
  if (!TABLE_NAME.test(table)) {
    throw new RangeError("Table name must be lower case letters, digits and underscores.");
  }
  const rows = (
    await engine.all(
      `SELECT arm, ` +
        `count(*) AS assigned, ` +
        `count(*) FILTER (WHERE converted IS NOT NULL) AS n, ` +
        `count(*) FILTER (WHERE converted) AS conversions, ` +
        `count(*) FILTER (WHERE converted IS NULL) AS pending ` +
        `FROM ${table} GROUP BY arm`,
    )
  ).map(toPlainRow);

  const empty = (): ArmTally => ({ assigned: 0, n: 0, conversions: 0, pending: 0 });
  const counts: ArmCounts = { treatment: empty(), control: empty() };
  for (const row of rows) {
    // The message never repeats the label, because it comes from user data.
    if (typeof row.arm !== "string" || !ARMS.has(row.arm)) {
      throw new Error("The data has an arm label other than treatment or control.");
    }
    counts[row.arm as keyof ArmCounts] = {
      assigned: Number(row.assigned),
      n: Number(row.n),
      conversions: Number(row.conversions),
      pending: Number(row.pending),
    };
  }
  return counts;
}

/**
 * Reads the optional boolean `received` column, if the table has one. A NULL means the row did not say, so it
 * counts as not reported, never as not received.
 */
async function deliveryCounts(
  engine: SqlEngine,
  table: string,
): Promise<{ treatment: { reported: number; received: number }; control: { reported: number; received: number } } | null> {
  const has = await engine.query(
    "SELECT count(*) AS n FROM information_schema.columns WHERE table_name = ? AND column_name = 'received'",
    [table],
  );
  if (Number(toPlainRow(has[0]).n) === 0) return null;
  const rows = (
    await engine.all(
      `SELECT arm, count(*) FILTER (WHERE received IS NOT NULL) AS reported, ` +
        `count(*) FILTER (WHERE received) AS received_yes FROM ${table} GROUP BY arm`,
    )
  ).map(toPlainRow);
  const out = { treatment: { reported: 0, received: 0 }, control: { reported: 0, received: 0 } };
  for (const row of rows) {
    if (row.arm === "treatment" || row.arm === "control") {
      out[row.arm] = { reported: Number(row.reported), received: Number(row.received_yes) };
    }
  }
  return out;
}

export type ExperimentReadout =
  | {
      status: "readable";
      counts: ArmCounts;
      srm: SrmResult;
      readout: Readout;
      /** From the optional received column, or null when the upload had none. */
      delivery: Delivery | null;
      message: string;
    }
  | { status: "blocked_srm"; counts: ArmCounts; srm: SrmResult; message: string }
  | { status: "waiting"; counts: ArmCounts; srm: SrmResult; message: string };

/**
 * Counts in DuckDB, then the mismatch check, then the readout. A failed
 * mismatch check blocks the readout, plan section 6.2.
 */
export async function experimentReadout(
  engine: SqlEngine,
  table: string,
  design: { treatmentShare: number; alpha?: number },
): Promise<ExperimentReadout> {
  const counts = await armCounts(engine, table);
  const srm = sampleRatioCheck(
    { treatment: counts.treatment.assigned, control: counts.control.assigned },
    design.treatmentShare,
  );
  const pending = counts.treatment.pending + counts.control.pending;
  const pendingNote =
    pending > 0 ? ` ${pending} people whose conversion window is still open are excluded.` : "";

  if (!srm.pass) {
    return {
      status: "blocked_srm",
      counts,
      srm,
      message:
        "Readout blocked: data problem. The arms do not match the planned split, " +
        "so the assignment or the tracking is broken. Fix the data before reading a result.",
    };
  }
  if (counts.treatment.n === 0 || counts.control.n === 0) {
    return {
      status: "waiting",
      counts,
      srm,
      message: `Waiting: no conversion window has closed yet in at least one arm.${pendingNote}`,
    };
  }
  const result = readout({
    treatment: { n: counts.treatment.n, conversions: counts.treatment.conversions },
    control: { n: counts.control.n, conversions: counts.control.conversions },
    alpha: design.alpha,
  });
  const delivered = await deliveryCounts(engine, table);
  return {
    status: "readable",
    counts,
    srm,
    readout: result,
    delivery: delivered ? deliverySummary({ ...delivered, lift: result.lift }) : null,
    message: `Readable.${pendingNote}`,
  };
}
