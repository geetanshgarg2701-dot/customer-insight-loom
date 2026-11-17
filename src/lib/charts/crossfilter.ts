import { toPlainRow } from "../duckdb/normalize";
import type { JourneyRow } from "../demo/journeys";
import type { SqlEngine } from "../intake/types";
import { insertRows } from "../ledger/ledger";

/**
 * The coordinator that links the charts, plan module M10. Each chart owns one dimension. A click on a bar sets that
 * dimension's selection, and every other chart is redrawn from SQL with the selections of all the other charts. A
 * chart ignores its own selection, so it keeps showing the choices it could switch to.
 *
 * Column names come from a fixed list and are never taken from the page. Values are bound as parameters, so a value
 * from a file or a click cannot change the SQL.
 */

export const JOURNEY_DIMENSIONS = ["channel", "segment", "reached"] as const;
export type JourneyDimension = (typeof JOURNEY_DIMENSIONS)[number];

/** Selected values per dimension. A missing or empty list means no filter on that dimension. */
export type Selection = Partial<Record<JourneyDimension, string[]>>;

const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;
const STEP_COLUMNS = ["s1", "s2", "s3", "s4"] as const;

function checkTable(table: string): void {
  if (!TABLE_NAME.test(table)) throw new RangeError("Table name must be lower case letters, digits and underscores.");
}

function checkDimension(name: string): asserts name is JourneyDimension {
  if (!(JOURNEY_DIMENSIONS as readonly string[]).includes(name)) {
    throw new RangeError("That is not a chart dimension.");
  }
}

export function whereClause(selection: Selection, except?: string): { sql: string; params: string[] } {
  if (except !== undefined) checkDimension(except);
  const parts: string[] = [];
  const params: string[] = [];
  for (const [key, values] of Object.entries(selection)) {
    checkDimension(key);
    if (key === except || !values || values.length === 0) continue;
    parts.push(`"${key}" IN (${values.map(() => "?").join(", ")})`);
    params.push(...values);
  }
  return { sql: parts.length ? `WHERE ${parts.join(" AND ")}` : "", params };
}

export async function loadJourneys(engine: SqlEngine, table: string, rows: readonly JourneyRow[]): Promise<void> {
  checkTable(table);
  await engine.exec(
    `CREATE OR REPLACE TABLE ${table} (channel VARCHAR, segment VARCHAR, s1 VARCHAR, s2 VARCHAR, s3 VARCHAR, s4 VARCHAR, reached VARCHAR)`,
  );
  await insertRows(
    engine,
    table,
    ["channel", "segment", ...STEP_COLUMNS, "reached"],
    rows.map((r) => [r.channel, r.segment, ...r.steps, r.reached]),
  );
}

export type Count = { value: string; count: number };

/** Rows per value of one dimension, filtered by every other dimension's selection. */
export async function countsBy(
  engine: SqlEngine,
  table: string,
  dimension: string,
  selection: Selection,
): Promise<Count[]> {
  checkTable(table);
  checkDimension(dimension);
  const where = whereClause(selection, dimension);
  const rows = await engine.query(
    `SELECT "${dimension}" AS value, count(*) AS count FROM ${table} ${where.sql} GROUP BY 1 ORDER BY 1`,
    where.params,
  );
  return rows.map(toPlainRow).map((r) => ({ value: String(r.value), count: Number(r.count) }));
}

export type SankeyEdge = { source: string; target: string; value: number };

/**
 * Flow between steps for the filtered customers. A customer who stops after a step flows into a drop off node for
 * that step, so at every column inflow equals outflow plus drop off, plan test 8. Node names carry the column number
 * so the same step in two columns cannot be mixed up.
 */
export async function sankeyEdges(engine: SqlEngine, table: string, selection: Selection): Promise<SankeyEdge[]> {
  checkTable(table);
  const where = whereClause(selection);
  const joiner = where.sql ? `${where.sql} AND` : "WHERE";
  const pieces: string[] = [];
  const params: string[] = [];
  for (let i = 1; i <= 3; i++) {
    pieces.push(
      `SELECT '${i}. ' || s${i} AS source, COALESCE('${i + 1}. ' || s${i + 1}, 'Dropped after ${i}. ' || s${i}) AS target, ` +
        `count(*) AS value FROM ${table} ${joiner} s${i} IS NOT NULL GROUP BY 1, 2`,
    );
    params.push(...where.params);
  }
  const rows = await engine.query(`${pieces.join(" UNION ALL ")} ORDER BY 1, 2`, params);
  return rows.map(toPlainRow).map((r) => ({ source: String(r.source), target: String(r.target), value: Number(r.value) }));
}
