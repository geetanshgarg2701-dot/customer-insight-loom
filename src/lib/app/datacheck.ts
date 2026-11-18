import { parseLocalTime } from "../time/time";

/** A small RFC 4180 reader for the check screen: quotes, doubled quotes, commas and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** The values under one header name, ignoring case, without the header row. Null when there is no such column. */
export function columnOf(rows: readonly string[][], name: string): string[] | null {
  if (rows.length === 0) return null;
  const at = rows[0].findIndex((h) => h.trim().toLowerCase() === name.trim().toLowerCase());
  if (at < 0) return null;
  return rows.slice(1).map((r) => r[at] ?? "");
}

export type TimeCheck = {
  total: number;
  blank: number;
  /** Zoneless times that read as exactly one instant in the workspace zone. */
  ok: number;
  /** Times that already carry a zone (Z or an offset). They do not depend on the setting. */
  withZone: number;
  /** 1-based data row numbers, as a person would count rows under the header. */
  missing: number[];
  ambiguous: number[];
  invalid: number[];
};

const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** Checks a column of upload times against the workspace zone. Nothing is guessed: odd times are listed by row. */
export function checkTimes(values: readonly string[], timeZone: string): TimeCheck {
  const out: TimeCheck = { total: values.length, blank: 0, ok: 0, withZone: 0, missing: [], ambiguous: [], invalid: [] };
  values.forEach((raw, i) => {
    const text = raw.trim();
    const row = i + 1;
    if (text === "") {
      out.blank++;
      return;
    }
    if (HAS_ZONE.test(text) && Number.isFinite(Date.parse(text))) {
      out.withZone++;
      return;
    }
    const t = parseLocalTime(text, timeZone);
    if (t.status === "ok") out.ok++;
    else if (t.status === "missing") out.missing.push(row);
    else if (t.status === "ambiguous") out.ambiguous.push(row);
    else out.invalid.push(row);
  });
  return out;
}
