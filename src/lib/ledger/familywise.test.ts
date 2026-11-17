import { describe, expect, it } from "vitest";
import { familywiseLine } from "./familywise";

const entry = (over: Partial<{ entryType: "confirmatory" | "exploratory" | null; result: unknown; synthetic: boolean }> = {}) => ({
  entryType: "confirmatory" as const,
  result: { lift: 0.01 },
  synthetic: false,
  ...over,
});
const many = (n: number, over = {}) => Array.from({ length: n }, () => entry(over));

describe("familywiseLine, review finding R1-7", () => {
  it("matches the review figures: 20 tests give 64.2 percent, 10 give 40.1 percent", () => {
    const twenty = familywiseLine(many(20))!;
    expect(twenty.tests).toBe(20);
    expect(twenty.chanceAtLeastOne).toBeCloseTo(0.6415, 3);
    expect(twenty.text).toContain("20 confirmatory tests");
    expect(twenty.text).toContain("about 1 false positive");
    expect(twenty.text).toContain("64.2 percent");

    const ten = familywiseLine(many(10))!;
    expect(ten.text).toContain("40.1 percent");
    expect(ten.text).toContain("about 0.5 false positives");
  });

  it("counts only confirmatory entries that have a recorded result", () => {
    const list = [
      ...many(3),
      entry({ entryType: "exploratory" }),
      entry({ result: null }),
      entry({ entryType: null }),
    ];
    expect(familywiseLine(list)!.tests).toBe(3);
  });

  it("leaves out synthetic demo entries, which are not real tests", () => {
    expect(familywiseLine([...many(2), ...many(5, { synthetic: true })])!.tests).toBe(2);
  });

  it("says nothing for fewer than two tests", () => {
    expect(familywiseLine([])).toBeNull();
    expect(familywiseLine(many(1))).toBeNull();
  });

  it("says the line is about the whole list, not any one test, and uses no em dash or parentheses", () => {
    const { text } = familywiseLine(many(4))!;
    expect(text).toMatch(/whole list/);
    expect(text).not.toMatch(/[\u2014()]/);
  });
});
