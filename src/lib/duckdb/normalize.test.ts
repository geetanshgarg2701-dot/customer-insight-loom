import { describe, expect, it } from "vitest";
import { toPlainRow, toPlainValue } from "./normalize";

describe("toPlainValue", () => {
  it("turns safe bigints into numbers", () => {
    expect(toPlainValue(BigInt(42))).toBe(42);
    expect(toPlainValue(BigInt(-7))).toBe(-7);
  });

  it("keeps bigints beyond the safe range as exact strings", () => {
    expect(toPlainValue(BigInt("9007199254740993"))).toBe("9007199254740993");
  });

  it("passes through numbers, strings, booleans and null", () => {
    expect(toPlainValue(1.5)).toBe(1.5);
    expect(toPlainValue("a")).toBe("a");
    expect(toPlainValue(true)).toBe(true);
    expect(toPlainValue(null)).toBeNull();
  });

  it("turns undefined into null", () => {
    expect(toPlainValue(undefined)).toBeNull();
  });
});

describe("toPlainRow", () => {
  it("converts every value in a row", () => {
    expect(toPlainRow({ n: BigInt(3), label: "x", missing: null })).toEqual({
      n: 3,
      label: "x",
      missing: null,
    });
  });
});
