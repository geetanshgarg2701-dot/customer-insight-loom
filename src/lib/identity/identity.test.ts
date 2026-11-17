import { describe, expect, it } from "vitest";
import { normalizeEmail } from "../assignment/hash";
import { maskEmail, matchIdentities } from "./identity";

const FULLWIDTH_A = String.fromCharCode(0xff21);
const NBSP = String.fromCharCode(0x00a0);
const APOSTROPHE = String.fromCharCode(39);

describe("normalizeEmail, plan section 5.5", () => {
  it("trims, lowercases and applies Unicode normalization, and nothing else", () => {
    expect(normalizeEmail("  Ana@Example.com ")).toBe("ana@example.com");
    expect(normalizeEmail(`${NBSP}Ana@Example.com`)).toBe("ana@example.com");
    expect(normalizeEmail(`${FULLWIDTH_A}na@example.com`)).toBe("ana@example.com");
  });

  it("leaves dots and plus tags alone", () => {
    expect(normalizeEmail("a.na@example.com")).toBe("a.na@example.com");
    expect(normalizeEmail("ana+promo@example.com")).toBe("ana+promo@example.com");
  });
});

describe("matchIdentities", () => {
  it("merges one customer under two spellings that differ only by case or spaces", () => {
    const r = matchIdentities({
      left: ["Ana@Example.com ", "bo@example.com"],
      right: ["ana@example.com", "cy@example.com"],
    });
    expect(r.matched).toEqual(["ana@example.com"]);
    expect(r.unmatchedLeft).toEqual(["bo@example.com"]);
    expect(r.unmatchedRight).toEqual(["cy@example.com"]);
    expect(r.customers).toBe(3);
    expect(r.records).toBe(4);
  });

  it("keeps a plus tag separate, lists it as unmatched, and points at the likely pair", () => {
    const r = matchIdentities({ left: ["ana@example.com"], right: ["ana+promo@example.com"] });
    expect(r.matched).toEqual([]);
    expect(r.unmatchedLeft).toEqual(["ana@example.com"]);
    expect(r.unmatchedRight).toEqual(["ana+promo@example.com"]);
    expect(r.possiblePairs).toEqual([{ left: "ana@example.com", right: "ana+promo@example.com" }]);
  });

  it("does not merge gmail style dots, and does not suggest them either", () => {
    const r = matchIdentities({ left: ["a.na@example.com"], right: ["ana@example.com"] });
    expect(r.matched).toEqual([]);
    expect(r.possiblePairs).toEqual([]);
  });

  it("counts a person once when a source repeats them, and says how many repeats it dropped", () => {
    const r = matchIdentities({
      left: ["ana@example.com", "ANA@example.com", " ana@example.com"],
      right: ["ana@example.com"],
    });
    expect(r.matched).toEqual(["ana@example.com"]);
    expect(r.duplicatesLeft).toBe(2);
    expect(r.duplicatesRight).toBe(0);
    expect(r.customers).toBe(1);
    expect(r.records).toBe(4);
  });

  it("counts addresses that are not addresses and leaves them out of every list", () => {
    const r = matchIdentities({ left: ["ana@example.com", "not an email", "", "a@b@c"], right: ["ana@example.com"] });
    expect(r.invalidLeft).toBe(3);
    expect(r.matched).toEqual(["ana@example.com"]);
    expect(r.unmatchedLeft).toEqual([]);
  });

  it("handles empty sources", () => {
    const r = matchIdentities({ left: [], right: [] });
    expect(r).toMatchObject({ customers: 0, records: 0, matched: [], unmatchedLeft: [], unmatchedRight: [], possiblePairs: [] });
  });

  it("matches the formula protected spelling a spreadsheet writes", () => {
    const r = matchIdentities({ left: [`${APOSTROPHE}=x@example.com`], right: ["=x@example.com"] });
    expect(r.matched).toEqual(["=x@example.com"]);
  });
});

describe("maskEmail", () => {
  it("keeps the first letter and the domain, so a list can be inspected without showing addresses", () => {
    expect(maskEmail("jane.doe@example.com")).toBe("j***@example.com");
    expect(maskEmail("a@example.com")).toBe("a***@example.com");
    expect(maskEmail("nonsense")).toBe("***");
  });
});
