import { describe, expect, it } from "vitest";
import { BlockedColumnError, isBlockedColumn } from "../redaction/columns";
import { MappingError } from "./errors";
import { MAX_TARGET_LENGTH, defaultMapping, validateMapping } from "./mapping";
import type { Header } from "./types";

function headers(...names: string[]): Header[] {
  return names.map((name, index) => ({ index, name, blocked: isBlockedColumn(name) }));
}

describe("defaultMapping", () => {
  it("includes allowed columns and leaves blocked columns out", () => {
    const m = defaultMapping(headers("id", "email", "comment"));
    expect(m.map((x) => x.include)).toEqual([true, false, true]);
  });

  it("makes duplicate names unique without case collisions", () => {
    const m = defaultMapping(headers("a", "a", "A", "comment"));
    expect(m.map((x) => x.target)).toEqual(["a", "a_2", "A_3", "comment"]);
  });

  it("names a blank header by position", () => {
    const m = defaultMapping(headers("id", "  ", "comment"));
    expect(m[1].target).toBe("column_2");
  });
});

describe("validateMapping", () => {
  const h = headers("id", "email", "comment");

  it("accepts a valid mapping", () => {
    expect(() =>
      validateMapping(h, [
        { source: 0, target: "id", include: true },
        { source: 2, target: "feedback", include: true },
      ]),
    ).not.toThrow();
  });

  it("requires at least one included column", () => {
    expect(() =>
      validateMapping(h, [{ source: 0, target: "id", include: false }]),
    ).toThrow(MappingError);
  });

  it("rejects an empty or too long target name", () => {
    expect(() =>
      validateMapping(h, [{ source: 0, target: "   ", include: true }]),
    ).toThrow(MappingError);
    expect(() =>
      validateMapping(h, [
        { source: 0, target: "x".repeat(MAX_TARGET_LENGTH + 1), include: true },
      ]),
    ).toThrow(MappingError);
  });

  it("rejects duplicate target names, ignoring case", () => {
    expect(() =>
      validateMapping(h, [
        { source: 0, target: "Score", include: true },
        { source: 2, target: "score", include: true },
      ]),
    ).toThrow(MappingError);
  });

  it("rejects a source column that does not exist", () => {
    expect(() =>
      validateMapping(h, [{ source: 9, target: "x", include: true }]),
    ).toThrow(MappingError);
    expect(() =>
      validateMapping(h, [{ source: 1.5, target: "x", include: true }]),
    ).toThrow(MappingError);
  });

  it("ignores a blocked column that is not included", () => {
    expect(() =>
      validateMapping(h, [
        { source: 1, target: "email", include: false },
        { source: 2, target: "comment", include: true },
      ]),
    ).not.toThrow();
  });

  it("does not trust the blocked flag the caller passes in", () => {
    const spoofed: Header[] = [{ index: 0, name: "email", blocked: false }];
    expect(() =>
      validateMapping(spoofed, [{ source: 0, target: "notes", include: true }]),
    ).toThrow(BlockedColumnError);
  });
});
