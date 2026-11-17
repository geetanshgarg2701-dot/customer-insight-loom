import { describe, expect, it } from "vitest";
import { FORMULA_START, normalizeEmail } from "../assignment/hash";
import { matchIdentities } from "../identity/identity";
import { LEDGER_CSV_COLUMNS, ledgerCsv } from "../ledger/csv";
import type { LedgerEntry } from "../ledger/ledger";
import { mulberry32 } from "../stats/honesty";
import { dailyCounts, localDayKey, parseLocalTime, withinWindow } from "../time/time";
import { csvLine } from "./csv";

/** Property tests for the text and time code. Seeded, so a failure can be reproduced. */

const rng = mulberry32(20261118);
const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = <T,>(list: readonly T[]) => list[int(0, list.length - 1)];

/** A small RFC 4180 reader, written separately from the writer so the two can disagree. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const ALPHABET = ['"', ",", "\r", "\n", "=", "+", "-", "@", "\t", " ", "'", "a", "b", "Z", "0", "é", "漢", "|", "\\", "(", ")"];
const randomText = (max: number) => Array.from({ length: int(0, max) }, () => pick(ALPHABET)).join("");

describe("csvLine, fuzzed", () => {
  it("reads back as the same cells, except that formula-like text gains one leading quote", () => {
    for (let i = 0; i < 400; i++) {
      const rows = Array.from({ length: int(1, 4) }, () => Array.from({ length: int(2, 5) }, () => randomText(14)));
      const parsed = parseCsv(rows.map(csvLine).join(""));
      expect(parsed, JSON.stringify(rows)).toHaveLength(rows.length);
      rows.forEach((row, r) => {
        expect(parsed[r]).toHaveLength(row.length);
        row.forEach((cell, c) => {
          const expected = FORMULA_START.test(cell) ? `'${cell}` : cell;
          expect(parsed[r][c], JSON.stringify(cell)).toBe(expected);
        });
      });
    }
  });

  it("never leaves a cell a spreadsheet would run as a formula", () => {
    for (let i = 0; i < 400; i++) {
      const cells = Array.from({ length: 3 }, () => randomText(10));
      for (const cell of parseCsv(csvLine(cells))[0]) expect(FORMULA_START.test(cell), JSON.stringify(cell)).toBe(false);
    }
  });
});

describe("ledgerCsv, fuzzed", () => {
  const entry = (title: string, hypothesis: string, id: string): LedgerEntry => ({
    id,
    workspaceId: "w",
    title,
    hypothesis,
    registeredAt: null,
    launchedAt: null,
    entryType: null,
    themeId: null,
    segmentId: null,
    journeyId: null,
    frameworkTag: null,
    design: null,
    powerResult: null,
    result: null,
    comparisonsCount: null,
    correctionMethod: null,
    status: "draft",
    provenance: "local",
    synthetic: false,
  });

  it("keeps every entry on one row of the right width, whatever its title and hypothesis contain", () => {
    for (let i = 0; i < 200; i++) {
      const entries = Array.from({ length: int(1, 5) }, (_, k) => entry(randomText(30), randomText(60), `id-${i}-${k}`));
      const parsed = parseCsv(ledgerCsv(entries, new Map()));
      expect(parsed).toHaveLength(entries.length + 1);
      expect(parsed[0]).toEqual([...LEDGER_CSV_COLUMNS]);
      entries.forEach((e, k) => {
        expect(parsed[k + 1], JSON.stringify(e.title)).toHaveLength(LEDGER_CSV_COLUMNS.length);
        expect(parsed[k + 1][0]).toBe(e.id);
        expect(parsed[k + 1][1]).toBe(FORMULA_START.test(e.title) ? `'${e.title}` : e.title);
        expect(parsed[k + 1][2]).toBe(FORMULA_START.test(e.hypothesis) ? `'${e.hypothesis}` : e.hypothesis);
      });
    }
  });
});

describe("normalizeEmail", () => {
  const WEIRD = ["A", "b", "İ", "ß", "ǅ", "ﬁ", "Ａ", "K", "Å", "ı", "ς", "Σ", "ﬃ", " ", " ", "@", ".", "+", "x", "漢", "É"];
  it("is idempotent, so normalizing a stored value again cannot move a person to another bucket", () => {
    for (let i = 0; i < 2000; i++) {
      const raw = Array.from({ length: int(1, 12) }, () => pick(WEIRD)).join("") + "@example.com";
      const once = normalizeEmail(raw);
      expect(normalizeEmail(once), JSON.stringify(raw)).toBe(once);
    }
  });

  it("gives the same result for the spellings the plan says must match", () => {
    for (let i = 0; i < 300; i++) {
      const local = Array.from({ length: int(1, 8) }, () => pick(["a", "b", "c", "d", "e", ".", "+", "1"])).join("") + "x";
      const plain = `${local}@example.com`;
      const messy = `${pick(["", " ", "  "])}${plain.toUpperCase()}${pick(["", " ", "\t"])}`;
      expect(normalizeEmail(messy)).toBe(normalizeEmail(plain));
    }
  });
});

describe("matchIdentities, fuzzed", () => {
  const people = Array.from({ length: 40 }, (_, i) => `person${i}@example.com`);
  const spelling = (e: string) => pick([e, e.toUpperCase(), ` ${e} `, e.replace("@", "+tag@")]);
  const sample = () => Array.from({ length: int(0, 60) }, () => (rng() < 0.1 ? pick(["", "nonsense", "a@b@c"]) : spelling(pick(people))));

  it("gives the same answer whichever list is called the left one", () => {
    for (let i = 0; i < 200; i++) {
      const a = sample();
      const b = sample();
      const ab = matchIdentities({ left: a, right: b });
      const ba = matchIdentities({ left: b, right: a });
      expect([...ab.matched].sort()).toEqual([...ba.matched].sort());
      expect([...ab.unmatchedLeft].sort()).toEqual([...ba.unmatchedRight].sort());
      expect([...ab.unmatchedRight].sort()).toEqual([...ba.unmatchedLeft].sort());
      expect(ab.customers).toBe(ba.customers);
      expect(ab.records).toBe(ba.records);
      expect(ab.duplicatesLeft).toBe(ba.duplicatesRight);
      expect(ab.invalidLeft).toBe(ba.invalidRight);
    }
  });

  it("counts every record once: matched, unmatched, repeats and invalid add back up to the total", () => {
    for (let i = 0; i < 200; i++) {
      const a = sample();
      const b = sample();
      const r = matchIdentities({ left: a, right: b });
      const left = r.matched.length + r.unmatchedLeft.length + r.duplicatesLeft + r.invalidLeft;
      const right = r.matched.length + r.unmatchedRight.length + r.duplicatesRight + r.invalidRight;
      expect(left).toBe(a.length);
      expect(right).toBe(b.length);
      expect(r.customers).toBe(r.matched.length + r.unmatchedLeft.length + r.unmatchedRight.length);
    }
  });

  it("matches every spelling of the same person, however the case and spaces differ", () => {
    for (let i = 0; i < 300; i++) {
      const e = pick(people);
      const r = matchIdentities({ left: [pick([e, e.toUpperCase(), ` ${e} `])], right: [pick([e, e.toUpperCase(), `\t${e}`])] });
      expect(r.matched).toEqual([normalizeEmail(e)]);
      expect(r.unmatchedLeft).toEqual([]);
      expect(r.unmatchedRight).toEqual([]);
    }
  });
});

const ZONES = ["America/Chicago", "Europe/London", "Asia/Kolkata", "Australia/Lord_Howe", "Pacific/Auckland", "America/St_Johns", "UTC"];

/** The local time in a zone, as YYYY-MM-DD HH:mm, written separately from the code under test. */
function localText(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .formatToParts(new Date(ms))
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** Days with a clock change in 2026 in the zones above, where the interesting cases live. */
const CHANGE_DAYS = ["2026-03-08", "2026-03-29", "2026-11-01", "2026-10-25", "2026-04-05", "2026-10-04", "2026-09-27", "2026-03-14", "2026-11-01"];

describe("parseLocalTime, fuzzed across zones and clock changes", () => {
  const randomLocal = () => {
    const day = rng() < 0.6 ? pick(CHANGE_DAYS) : `2026-${String(int(1, 12)).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")}`;
    const hour = rng() < 0.6 ? int(0, 4) : int(0, 23);
    return `${day} ${String(hour).padStart(2, "0")}:${String(pick([0, 15, 30, 45, int(0, 59)])).padStart(2, "0")}`;
  };

  it("returns an instant that reads back as the time that was typed, or flags the time as missing or repeated", () => {
    let ok = 0;
    let missing = 0;
    let ambiguous = 0;
    for (let i = 0; i < 1500; i++) {
      const zone = pick(ZONES);
      const text = randomLocal();
      const r = parseLocalTime(text, zone);
      if (r.status === "ok") {
        ok++;
        expect(localText(Date.parse(r.instant), zone), `${text} in ${zone}`).toBe(text);
      } else if (r.status === "ambiguous") {
        ambiguous++;
        const [first, second] = r.instants.map((x) => Date.parse(x));
        expect(first).toBeLessThan(second);
        expect(localText(first, zone), `${text} in ${zone}`).toBe(text);
        expect(localText(second, zone), `${text} in ${zone}`).toBe(text);
        // A repeated hour repeats by the size of the clock change, 30 or 60 minutes.
        expect([30, 60]).toContain((second - first) / 60_000);
      } else if (r.status === "missing") {
        missing++;
        // Nothing within three hours either side reads as that time, so it really never happened.
        const around = Date.parse(`${text.replace(" ", "T")}:00Z`);
        for (let m = -180; m <= 180; m++) expect(localText(around + m * 60_000, zone), `${text} in ${zone}`).not.toBe(text);
      } else {
        throw new Error(`a valid time was called invalid: ${text} in ${zone}`);
      }
    }
    // The fuzz really reaches all three outcomes, so it is not passing by only seeing the easy one.
    console.log(`parseLocalTime fuzz: ${ok} ok, ${ambiguous} repeated, ${missing} missing`);
    expect(ok).toBeGreaterThan(500);
    expect(ambiguous).toBeGreaterThan(0);
    expect(missing).toBeGreaterThan(0);
  });
});

describe("days and windows, fuzzed", () => {
  it("never moves an event to an earlier day when time moves forward, and counts every valid event once", () => {
    for (let i = 0; i < 100; i++) {
      const zone = pick(ZONES);
      const start = Date.parse("2026-01-01T00:00:00Z") + int(0, 330) * 86_400_000;
      const times = Array.from({ length: 200 }, () => start + int(0, 6 * 86_400_000)).sort((a, b) => a - b);
      const keys = times.map((t) => localDayKey(new Date(t).toISOString(), zone));
      for (let k = 1; k < keys.length; k++) expect(keys[k] >= keys[k - 1], `${zone} ${keys[k - 1]} then ${keys[k]}`).toBe(true);
      const counts = dailyCounts([...times.map((t) => new Date(t).toISOString()), "", "nope"], zone);
      expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(times.length);
      expect(counts.excluded).toBe(2);
    }
  });

  it("counts a conversion inside the window exactly when it falls between entry and entry plus the window", () => {
    for (let i = 0; i < 500; i++) {
      const entry = Date.parse("2026-01-01T00:00:00Z") + int(0, 300 * 86_400_000);
      const hours = int(1, 24 * 60);
      const offset = int(-2 * 86_400_000, hours * 3_600_000 + 2 * 86_400_000);
      const inside = offset >= 0 && offset <= hours * 3_600_000;
      expect(withinWindow(new Date(entry).toISOString(), new Date(entry + offset).toISOString(), hours)).toBe(inside);
    }
  });
});
