import { describe, expect, it } from "vitest";
import { normalizeBasePath } from "./base-path";

describe("normalizeBasePath", () => {
  it("means the site root when there is no prefix", () => {
    expect(normalizeBasePath(undefined)).toBeUndefined();
    expect(normalizeBasePath("")).toBeUndefined();
    expect(normalizeBasePath("   ")).toBeUndefined();
    expect(normalizeBasePath("/")).toBeUndefined();
  });

  it("gives a leading slash and no trailing slash, however it was written", () => {
    expect(normalizeBasePath("evidence-ledger")).toBe("/evidence-ledger");
    expect(normalizeBasePath("/evidence-ledger")).toBe("/evidence-ledger");
    expect(normalizeBasePath("/evidence-ledger/")).toBe("/evidence-ledger");
    expect(normalizeBasePath("  /evidence-ledger  ")).toBe("/evidence-ledger");
    expect(normalizeBasePath("a/b")).toBe("/a/b");
  });

  it("explains a Windows path, which is what Git Bash makes of a leading slash", () => {
    expect(() => normalizeBasePath("C:/Program Files/Git/evidence-ledger")).toThrow(/Git Bash/);
    expect(() => normalizeBasePath("C:\\Program Files\\Git\\evidence-ledger")).toThrow(/without the leading slash/);
  });

  it("refuses a prefix that could break out of the path or is not a path", () => {
    for (const bad of ["../x", "a/../b", "a b", "a?b", "a#b", "http://example.com/x", "//x"]) {
      expect(() => normalizeBasePath(bad), bad).toThrow(RangeError);
    }
  });
});
