import { describe, expect, it } from "vitest";
import { luhnValid } from "./luhn";

describe("luhnValid", () => {
  it("accepts published test-card numbers", () => {
    expect(luhnValid("4242424242424242")).toBe(true);
    expect(luhnValid("378282246310005")).toBe(true);
    expect(luhnValid("6011111111111117")).toBe(true);
  });

  it("rejects a number with one wrong digit", () => {
    expect(luhnValid("4242424242424241")).toBe(false);
    expect(luhnValid("378282246310006")).toBe(false);
  });

  it("rejects empty and non-digit input", () => {
    expect(luhnValid("")).toBe(false);
    expect(luhnValid("4242 4242 4242 4242")).toBe(false);
    expect(luhnValid("abcd")).toBe(false);
  });
});
