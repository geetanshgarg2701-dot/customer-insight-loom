import { describe, expect, it } from "vitest";
import { HEALTH_WEIGHTS, bandOf, scoreHealth, type ColumnHealth, type HealthInput } from "./health";

const col = (over: Partial<ColumnHealth> = {}): ColumnHealth => ({
  name: "col",
  nonNull: 1000,
  placeholders: 0,
  distinct: 500,
  kind: "text",
  invalid: 0,
  strayWhitespace: 0,
  ...over,
});

const clean = (over: Partial<HealthInput> = {}): HealthInput => ({
  rowsInFile: 1000,
  rows: 1000,
  duplicateRows: 0,
  // One text column and one number column, so validity is scored and the standard weights apply.
  columns: [col({ name: "a" }), col({ name: "b", kind: "number" })],
  ...over,
});

describe("the weights", () => {
  it("add up to 100", () => {
    expect(Object.values(HEALTH_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("scoring a file worked out by hand", () => {
  // 1000 rows, 4 columns, so 4000 cells.
  //   Completeness 35: 200 cells missing, 5 percent, so 35 x 0.95 = 33.25.
  //   Uniqueness 20: 10 duplicate rows, 1 percent, so 20 x 0.99 = 19.8.
  //   Validity 20: two typed columns, every filled cell valid, so 20.
  //   Tidiness 10: 40 cells with stray spaces out of 3800 filled cells, so 10 x (1 - 40/3800) = 9.894736...
  //   Row integrity 15: every row loaded, so 15.
  //   Total 97.944736..., which rounds to 98.
  const input: HealthInput = {
    rowsInFile: 1000,
    rows: 1000,
    duplicateRows: 10,
    columns: [
      col({ name: "order_id", nonNull: 950, distinct: 950 }),
      col({ name: "amount", nonNull: 950, kind: "number", invalid: 9, strayWhitespace: 40 }),
      col({ name: "order_date", nonNull: 950, kind: "date", invalid: 0 }),
      col({ name: "note", nonNull: 950 }),
    ],
  };
  // The same file with no invalid cell, which is the case the hand figure above describes.
  const exact: HealthInput = {
    ...input,
    columns: [
      col({ name: "order_id", nonNull: 950, distinct: 950 }),
      col({ name: "amount", nonNull: 950, kind: "number", invalid: 0, strayWhitespace: 40 }),
      col({ name: "order_date", nonNull: 950, kind: "date", invalid: 0 }),
      col({ name: "note", nonNull: 950 }),
    ],
  };

  it("scores the clean parts as full marks and the rest as the formula says", () => {
    const r = scoreHealth(exact);
    expect(r.parts.completeness.points).toBeCloseTo(33.25, 6);
    expect(r.parts.uniqueness.points).toBeCloseTo(19.8, 6);
    expect(r.parts.validity.points).toBeCloseTo(20, 6);
    expect(r.parts.tidiness.points).toBeCloseTo(10 * (1 - 40 / 3800), 6);
    expect(r.parts.rowIntegrity.points).toBeCloseTo(15, 6);
    expect(r.score).toBe(Math.round(33.25 + 19.8 + 20 + 10 * (1 - 40 / 3800) + 15));
  });

  it("counts invalid numbers against validity in proportion to the filled cells of the typed columns", () => {
    // Two typed columns of 950 filled cells each, 9 invalid in one. Validity share = 1 - 9/1900.
    const r = scoreHealth(input);
    expect(r.parts.validity.points).toBeCloseTo(20 * (1 - 9 / 1900), 6);
  });
});

describe("what each flaw costs", () => {
  it("scores a perfect file 100", () => {
    const r = scoreHealth(clean());
    expect(r.score).toBe(100);
    expect(r.band).toBe("good");
    expect(r.findings).toEqual([]);
  });

  it("treats placeholder text such as N/A as missing, not as a value", () => {
    // 1000 rows, 2 columns, 2000 cells. Column a has 100 placeholders, so 100 cells are missing: 35 x 0.95.
    const r = scoreHealth(clean({ columns: [col({ name: "a", placeholders: 100 }), col({ name: "b", kind: "number" })] }));
    expect(r.parts.completeness.points).toBeCloseTo(33.25, 6);
    expect(r.findings.find((f) => f.id === "placeholders")).toMatchObject({ column: "a", count: 100 });
  });

  it("counts rows skipped for the wrong number of fields against row integrity", () => {
    // 1000 loaded out of 1250 in the file: 15 x 0.8 = 12.
    const r = scoreHealth(clean({ rowsInFile: 1250 }));
    expect(r.parts.rowIntegrity.points).toBeCloseTo(12, 6);
    expect(r.findings[0]).toMatchObject({ id: "skipped-rows", count: 250, severity: "high" });
  });

  it("counts duplicate rows against uniqueness", () => {
    const r = scoreHealth(clean({ duplicateRows: 250 }));
    expect(r.parts.uniqueness.points).toBeCloseTo(15, 6);
    expect(r.findings.find((f) => f.id === "duplicate-rows")).toMatchObject({ count: 250, severity: "high" });
  });

  it("measures duplicates against the rows that loaded, not against the rows in the file", () => {
    // 1250 rows in the file, 250 skipped, 1000 loaded, 250 of the loaded rows repeat: 25 percent, so 20 x 0.75 = 15.
    const r = scoreHealth(clean({ rowsInFile: 1250, duplicateRows: 250 }));
    expect(r.parts.uniqueness.points).toBeCloseTo(15, 6);
  });

  it("leaves validity out and shares its weight when no column is a number or a date", () => {
    // No typed column. The 20 points of validity go to the other four in proportion to their weights, 80 in all,
    // so a file perfect in the other four still scores 100 and one flaw costs a little more than it would otherwise.
    const r = scoreHealth(clean({ duplicateRows: 100, columns: [col({ name: "a" }), col({ name: "b" })] }));
    expect(r.parts.validity.scored).toBe(false);
    expect(r.parts.validity.points).toBe(0);
    // Uniqueness: 90 percent unique. Scaled: (20 / 80) * 100 = 25 points of the 100 are uniqueness, so 25 x 0.9 = 22.5, and the rest full: 75.
    expect(r.score).toBe(Math.round(75 + 22.5));
  });

  it("scores an empty file 0 without dividing by zero", () => {
    const r = scoreHealth({ rowsInFile: 0, rows: 0, duplicateRows: 0, columns: [col({ nonNull: 0 })] });
    expect(r.score).toBe(0);
    expect(r.band).toBe("poor");
    expect(r.findings[0].id).toBe("no-rows");
  });
});

describe("the findings", () => {
  const messy = scoreHealth({
    rowsInFile: 1000,
    rows: 1000,
    duplicateRows: 0,
    columns: [
      col({ name: "empty_col", nonNull: 0 }),
      col({ name: "mostly_empty", nonNull: 300 }),
      col({ name: "amount", nonNull: 1000, kind: "number", invalid: 40, strayWhitespace: 0 }),
      col({ name: "when", nonNull: 1000, kind: "date", invalid: 5 }),
      col({ name: "same", nonNull: 1000, distinct: 1 }),
      col({ name: "spaces", nonNull: 1000, strayWhitespace: 120 }),
    ],
  });

  it("names the column, the count and a fix for each problem, with the worst first", () => {
    const ids = messy.findings.map((f) => `${f.id}:${f.column}`);
    expect(ids).toContain("empty-column:empty_col");
    expect(ids).toContain("mostly-empty:mostly_empty");
    expect(ids).toContain("invalid-numbers:amount");
    expect(ids).toContain("invalid-dates:when");
    expect(ids).toContain("constant-column:same");
    expect(ids).toContain("stray-spaces:spaces");
    const order = { high: 0, medium: 1, low: 2, info: 3 } as const;
    const sevs = messy.findings.map((f) => order[f.severity]);
    expect(sevs).toEqual([...sevs].sort((a, b) => a - b));
    for (const f of messy.findings) {
      expect(f.text.length).toBeGreaterThan(10);
      expect(f.fix.length).toBeGreaterThan(10);
    }
  });

  it("does not flag a constant column as a cost, only as information", () => {
    expect(messy.findings.find((f) => f.id === "constant-column")!.severity).toBe("info");
    const without = scoreHealth({ ...clean(), columns: [col({ name: "same", distinct: 1 }), col({ name: "b" })] });
    expect(without.score).toBe(100);
  });

  it("says in plain words that a score cannot tell right values from wrong ones", () => {
    expect(messy.caveat).toMatch(/cannot tell whether a value is right/i);
  });

  it("never carries a cell value, only column names, counts and row numbers", () => {
    const text = JSON.stringify(messy);
    expect(text).not.toMatch(/@/);
  });
});

describe("the bands", () => {
  it.each([
    [100, "good"],
    [90, "good"],
    [89, "fair"],
    [75, "fair"],
    [74, "poor"],
    [0, "poor"],
  ])("a score of %i is %s", (score, band) => {
    expect(bandOf(score)).toBe(band);
  });
});
