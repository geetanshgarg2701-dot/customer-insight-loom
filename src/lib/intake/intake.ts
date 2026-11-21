import { isBlockedColumn } from "../redaction/columns";
import { detectAll } from "../redaction/detectors";
import { toPlainRow } from "../duckdb/normalize";
import {
  CsvParseError,
  EmptyFileError,
  NotLoadedError,
  NotOpenError,
  TooManyColumnsError,
  UnsupportedDelimiterError,
  type OtherDelimiter,
} from "./errors";
import { scoreHealth, type ColumnHealth, type ColumnKind, type HealthReport } from "./health";
import { validateMapping } from "./mapping";
import type {
  Header,
  Intake,
  LoadResult,
  MappingEntry,
  Preview,
  SkipReason,
  SqlEngine,
} from "./types";

const FILE_NAME = "intake_upload.csv";
const TABLE = "intake_rows";

export const PREVIEW_ROWS = 20;
export const PREVIEW_CELL_MAX = 500;
export const MAX_COLUMNS = 1000;
export const MAX_LINE_BYTES = 8 * 1024 * 1024;
const SKIP_EXAMPLES = 20;

/** Words that stand for "no value". A cell that says one of these is counted as missing in the health report. */
const PLACEHOLDERS = ["n/a", "na", "#n/a", "n.a.", "null", "none", "nan", "-", "--", "unknown", "?"];
const PLACEHOLDER_LIST = PLACEHOLDERS.map((w) => `'${w.replace(/'/g, "''")}'`).join(",");
const DATE_SHAPE = "'^\\d{4}-\\d{2}-\\d{2}'";
/** A column is a number or a date column when at least this share of its filled cells look like one. */
const KIND_SHARE = 0.8;
const HEALTH_CHUNK = 40;
const HEALTH_EXAMPLES = 5;

/**
 * Stands in for NULL while reading, so an empty field stays an empty string
 * and only a field that is missing from a short row becomes NULL.
 */
const NULL_SENTINEL = "__intake_null_7f3a__";

/**
 * Every column is declared by position, so SQL identifiers never come from the
 * file or from the user. The reader pads short rows with NULL and keeps going.
 */
function readCsv(width: number): string {
  const columns = Array.from({ length: width }, (_, i) => `'c${i}':'VARCHAR'`).join(",");
  return (
    `read_csv('${FILE_NAME}', header=false, auto_detect=false, columns={${columns}}, ` +
    `delim=',', quote='"', escape='"', strict_mode=false, null_padding=true, ` +
    `nullstr='${NULL_SENTINEL}', max_line_size=${MAX_LINE_BYTES})`
  );
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function isBlank(bytes: Uint8Array): boolean {
  let i = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  for (; i < bytes.length; i++) {
    const b = bytes[i];
    if (b !== 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) return false;
  }
  return true;
}

const OTHER_DELIMITERS: OtherDelimiter[] = [";", "\t", "|"];

/**
 * A file read as one column whose header holds many semicolons, tabs or pipes
 * is almost certainly not comma separated. To avoid flagging a real single
 * column file, the first data row must hold the same character too.
 * Returns null when nothing looks wrong.
 */
function guessOtherDelimiter(header: string, firstRow: string | null): OtherDelimiter | null {
  let best: OtherDelimiter | null = null;
  let bestCount = 0;
  for (const d of OTHER_DELIMITERS) {
    const count = header.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  if (!best) return null;
  if (firstRow !== null && !firstRow.includes(best)) return null;
  return best;
}

/** Turns an engine failure into a message that holds no file text. */
function toParseError(error: unknown): CsvParseError {
  const text = error instanceof Error ? error.message : String(error);
  const line = /Line:\s*(\d+)/i.exec(text);
  const lineNumber = line ? Number(line[1]) : null;
  if (/max_line_size|maximum line size|line size/i.test(text)) {
    return new CsvParseError(
      `A row is longer than the ${MAX_LINE_BYTES / (1024 * 1024)} MB limit. Shorten that row and try again.`,
      lineNumber,
    );
  }
  const where = lineNumber === null ? "" : ` Check near line ${lineNumber}.`;
  return new CsvParseError(
    `The file could not be read as a UTF-8 CSV with comma separators.${where}`,
    lineNumber,
  );
}

export function createIntake(engine: SqlEngine): Intake {
  let fileRegistered = false;
  let headers: Header[] | null = null;
  let loaded: { targets: string[]; rowCount: number } | null = null;

  async function reset(): Promise<void> {
    headers = null;
    loaded = null;
    try {
      await engine.exec(`DROP TABLE IF EXISTS ${TABLE}`);
    } catch {
      // The table may not exist and the engine may already be closed.
    }
    if (fileRegistered) {
      fileRegistered = false;
      try {
        await engine.dropFile(FILE_NAME);
      } catch {
        // Dropping an unknown file is not an error worth surfacing.
      }
    }
  }

  return {
    async open(bytes) {
      await reset();
      if (isBlank(bytes)) throw new EmptyFileError();

      await engine.registerFile(FILE_NAME, bytes);
      fileRegistered = true;

      let first: Record<string, unknown> | undefined;
      let second: Record<string, unknown> | undefined;
      try {
        [first, second] = await engine.all(
          `SELECT * FROM ${readCsv(MAX_COLUMNS + 1)} LIMIT 2`,
        );
      } catch (error) {
        await reset();
        throw toParseError(error);
      }
      if (!first) {
        await reset();
        throw new EmptyFileError();
      }

      const cells = Object.values(first);
      let width = 0;
      while (width < cells.length && cells[width] !== null) width++;
      if (width === 0) {
        await reset();
        throw new EmptyFileError();
      }
      if (width > MAX_COLUMNS) {
        await reset();
        throw new TooManyColumnsError(MAX_COLUMNS);
      }
      if (width === 1) {
        const headerText = stripBom(String(cells[0]));
        const next = second ? Object.values(second)[0] : null;
        const other = guessOtherDelimiter(headerText, next === null || next === undefined ? null : String(next));
        if (other) {
          await reset();
          throw new UnsupportedDelimiterError(other);
        }
      }

      headers = cells.slice(0, width).map((cell, index) => {
        const raw = stripBom(String(cell));
        const blocked = isBlockedColumn(raw);
        // A header that holds personal data, as in a file with no header row,
        // is shown as a position so the data never reaches the screen.
        const looksLikeData = detectAll(raw).length > 0;
        return { index, name: looksLikeData ? `Column ${index + 1}` : raw, blocked };
      });
      return headers.map((h) => ({ ...h }));
    },

    async load(mapping: MappingEntry[]): Promise<LoadResult> {
      if (!headers) throw new NotOpenError();
      validateMapping(headers, mapping);

      const chosen = mapping.filter((m) => m.include);
      const width = headers.length;
      const anyMissing = Array.from({ length: width }, (_, i) => `c${i} IS NULL`).join(" OR ");
      const kind =
        `CASE WHEN c${width} IS NOT NULL THEN 'many' ` +
        `WHEN ${anyMissing} THEN 'few' ELSE 'ok' END`;
      // Values of rows that are skipped are not kept.
      const values = chosen
        .map((m, i) => `CASE WHEN _k = 'ok' THEN NULLIF(c${m.source}, '') END AS v${i}`)
        .join(", ");

      loaded = null;
      try {
        await engine.exec(
          `CREATE OR REPLACE TABLE ${TABLE} AS ` +
            `SELECT _n - 1 AS _row, _k AS _kind, ${values} ` +
            `FROM (SELECT *, row_number() OVER () AS _n, ${kind} AS _k ` +
            `FROM ${readCsv(width + 1)}) WHERE _n > 1`,
        );
      } catch (error) {
        await engine.exec(`DROP TABLE IF EXISTS ${TABLE}`).catch(() => {});
        throw toParseError(error);
      }

      const counts = (
        await engine.all(`SELECT _kind AS kind, count(*) AS n FROM ${TABLE} GROUP BY _kind`)
      ).map(toPlainRow);
      const countOf = (kind: string): number => {
        const row = counts.find((r) => r.kind === kind);
        return row ? Number(row.n) : 0;
      };
      const examples = (
        await engine.all(
          `SELECT _row AS row, _kind AS kind FROM ${TABLE} WHERE _kind <> 'ok' ` +
            `ORDER BY _row LIMIT ${SKIP_EXAMPLES}`,
        )
      ).map(toPlainRow);

      loaded = {
        targets: chosen.map((m) => m.target.trim()),
        rowCount: countOf("ok"),
      };
      return {
        rowCount: loaded.rowCount,
        skipped: {
          tooFewFields: countOf("few"),
          tooManyFields: countOf("many"),
          examples: examples.map((r) => ({
            row: Number(r.row),
            reason: (r.kind === "few" ? "too_few_fields" : "too_many_fields") as SkipReason,
          })),
        },
      };
    },

    async preview(): Promise<Preview> {
      if (!loaded) throw new NotLoadedError();
      const select = loaded.targets
        .map(
          (_, i) =>
            `CASE WHEN length(v${i}) > ${PREVIEW_CELL_MAX} ` +
            `THEN substr(v${i}, 1, ${PREVIEW_CELL_MAX}) || '...' ELSE v${i} END AS v${i}`,
        )
        .join(", ");
      const rows = await engine.all(
        `SELECT ${select} FROM ${TABLE} WHERE _kind = 'ok' ORDER BY _row LIMIT ${PREVIEW_ROWS}`,
      );
      return {
        columns: [...loaded.targets],
        rows: rows.map((r) => {
          const plain = toPlainRow(r);
          return loaded!.targets.map((_, i) => {
            const v = plain[`v${i}`];
            return v === null || v === undefined ? null : String(v);
          });
        }),
        rowCount: loaded.rowCount,
      };
    },

    async health(): Promise<HealthReport> {
      if (!loaded) throw new NotLoadedError();
      const n = loaded.targets.length;
      const real = (i: number) => `v${i} IS NOT NULL AND lower(trim(v${i})) NOT IN (${PLACEHOLDER_LIST})`;
      const isNumber = (i: number) => `TRY_CAST(trim(v${i}) AS DOUBLE) IS NOT NULL`;
      const dateLike = (i: number) => `regexp_matches(v${i}, ${DATE_SHAPE})`;
      const validDate = (i: number) => `${dateLike(i)} AND TRY_CAST(substr(v${i}, 1, 10) AS DATE) IS NOT NULL`;

      const total = (
        await engine.all(
          `SELECT count(*) AS file_rows, count(*) FILTER (WHERE _kind = 'ok') AS rows FROM ${TABLE}`,
        )
      ).map(toPlainRow)[0];
      const rowsInFile = Number(total.file_rows);
      const rows = Number(total.rows);

      const allValues = Array.from({ length: n }, (_, i) => `v${i}`).join(", ");
      const distinctRows = n === 0 || rows === 0 ? 0 : Number(
        (await engine.all(`SELECT count(*) AS d FROM (SELECT DISTINCT ${allValues} FROM ${TABLE} WHERE _kind = 'ok')`)).map(toPlainRow)[0].d,
      );
      const duplicateRows = rows === 0 ? 0 : rows - distinctRows;

      const columns: ColumnHealth[] = [];
      for (let from = 0; from < n; from += HEALTH_CHUNK) {
        const upTo = Math.min(n, from + HEALTH_CHUNK);
        const parts: string[] = [];
        for (let i = from; i < upTo; i++) {
          parts.push(
            `count(v${i}) AS nn${i}`,
            `count(DISTINCT v${i}) AS d${i}`,
            `count(*) FILTER (WHERE v${i} IS NOT NULL AND lower(trim(v${i})) IN (${PLACEHOLDER_LIST})) AS ph${i}`,
            `count(*) FILTER (WHERE ${real(i)} AND ${isNumber(i)}) AS num${i}`,
            `count(*) FILTER (WHERE ${real(i)} AND ${dateLike(i)}) AS dl${i}`,
            `count(*) FILTER (WHERE ${real(i)} AND ${validDate(i)}) AS dv${i}`,
            `count(*) FILTER (WHERE v${i} IS NOT NULL AND v${i} <> trim(v${i})) AS ws${i}`,
          );
        }
        const stats = toPlainRow((await engine.all(`SELECT ${parts.join(", ")} FROM ${TABLE} WHERE _kind = 'ok'`))[0]);
        for (let i = from; i < upTo; i++) {
          const nonNull = Number(stats[`nn${i}`]);
          const placeholders = Number(stats[`ph${i}`]);
          const filled = nonNull - placeholders;
          const num = Number(stats[`num${i}`]);
          const dl = Number(stats[`dl${i}`]);
          const dv = Number(stats[`dv${i}`]);
          const kind: ColumnKind = filled === 0 ? "text" : num / filled >= KIND_SHARE ? "number" : dl / filled >= KIND_SHARE ? "date" : "text";
          const invalid = kind === "number" ? filled - num : kind === "date" ? filled - dv : 0;
          const column: ColumnHealth = {
            name: loaded.targets[i],
            nonNull,
            placeholders,
            distinct: Number(stats[`d${i}`]),
            kind,
            invalid,
            strayWhitespace: Number(stats[`ws${i}`]),
          };
          if (invalid > 0) {
            const bad = kind === "number" ? `NOT (${isNumber(i)})` : `NOT (${validDate(i)})`;
            const found = await engine.all(
              `SELECT _row AS row FROM ${TABLE} WHERE _kind = 'ok' AND ${real(i)} AND ${bad} ORDER BY _row LIMIT ${HEALTH_EXAMPLES}`,
            );
            column.examples = found.map((r) => Number(toPlainRow(r).row));
          }
          columns.push(column);
        }
      }
      return scoreHealth({ rowsInFile, rows, duplicateRows, columns });
    },

    async readColumnsForMatching(indices) {
      if (!headers) throw new NotOpenError();
      const width = headers.length;
      if (indices.length === 0 || indices.some((i) => !Number.isInteger(i) || i < 0 || i >= width)) {
        throw new RangeError("Choose columns that exist in the file.");
      }
      const anyMissing = Array.from({ length: width }, (_, i) => `c${i} IS NULL`).join(" OR ");
      const kind =
        `CASE WHEN c${width} IS NOT NULL THEN 'many' ` +
        `WHEN ${anyMissing} THEN 'few' ELSE 'ok' END`;
      const picked = indices.map((source, i) => `NULLIF(c${source}, '') AS v${i}`).join(", ");
      let raw: Record<string, unknown>[];
      try {
        raw = await engine.all(
          `SELECT _k, ${picked} FROM (SELECT *, row_number() OVER () AS _n, ${kind} AS _k ` +
            `FROM ${readCsv(width + 1)}) WHERE _n > 1 ORDER BY _n`,
        );
      } catch (error) {
        throw toParseError(error);
      }
      const rows: (string | null)[][] = [];
      let tooFewFields = 0;
      let tooManyFields = 0;
      for (const r of raw) {
        const plain = toPlainRow(r);
        if (plain._k === "few") tooFewFields++;
        else if (plain._k === "many") tooManyFields++;
        else rows.push(indices.map((_, i) => (plain[`v${i}`] === null ? null : String(plain[`v${i}`]))));
      }
      return { rows, skipped: { tooFewFields, tooManyFields } };
    },

    async close() {
      await reset();
      await engine.close?.();
    },
  };
}
