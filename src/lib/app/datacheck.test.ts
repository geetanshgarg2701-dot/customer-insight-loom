import { describe, expect, it } from "vitest";
import { checkTimes, columnOf, parseCsv } from "./datacheck";

describe("parseCsv", () => {
  it("reads quoted commas, quotes and line breaks, and either line ending", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n"two\nlines",z')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["two\nlines", "z"],
    ]);
  });

  it("drops a byte order mark and a final blank line, and keeps an empty cell", () => {
    expect(parseCsv("﻿a,b\n1,\n")).toEqual([["a", "b"], ["1", ""]]);
  });

  it("returns no rows for an empty file", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("columnOf", () => {
  const rows = [["Email", "Joined"], ["a@x.com", "2026-03-07 12:00"], ["b@x.com", ""]];
  it("finds a column by name ignoring case and returns the values without the header", () => {
    expect(columnOf(rows, "email")).toEqual(["a@x.com", "b@x.com"]);
  });
  it("returns null when the column is missing", () => {
    expect(columnOf(rows, "phone")).toBeNull();
  });
});

describe("checkTimes", () => {
  const CHICAGO = "America/Chicago";

  it("counts ordinary, missing, repeated and unreadable times, and lists their rows", () => {
    const r = checkTimes(
      [
        "2026-03-07 12:00", // ok
        "2026-03-08 02:30", // missing (spring)
        "2026-11-01 01:30", // repeated (fall)
        "yesterday", // unreadable
        "2026-03-07T18:00:00Z", // has a zone already
        "",
      ],
      CHICAGO,
    );
    expect(r.ok).toBe(1);
    expect(r.withZone).toBe(1);
    expect(r.missing).toEqual([2]);
    expect(r.ambiguous).toEqual([3]);
    expect(r.invalid).toEqual([4]);
    expect(r.blank).toBe(1);
    expect(r.total).toBe(6);
  });

  it("accounts for every row exactly once", () => {
    const r = checkTimes(["2026-03-08 02:30", "2026-06-01 09:00", "", "bad", "2026-06-01T09:00:00+02:00"], CHICAGO);
    expect(r.ok + r.withZone + r.missing.length + r.ambiguous.length + r.invalid.length + r.blank).toBe(r.total);
  });

  it("reads a UTC file the same in any zone, so only zoneless times depend on the setting", () => {
    const rows = ["2026-03-08T12:00:00Z", "2026-11-01T06:30:00Z"];
    expect(checkTimes(rows, "UTC")).toEqual(checkTimes(rows, CHICAGO));
  });
});
