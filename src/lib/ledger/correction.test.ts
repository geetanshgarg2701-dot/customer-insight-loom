import { describe, expect, it } from "vitest";
import { correctionFor, correctionLine, correctionShort } from "./correction";
import { CORRECTION_METHODS } from "./ledger";

describe("correctionFor: the label must say what the code did", () => {
  it("says no correction was applied for a confirmatory entry with one comparison", () => {
    // A readout is one treatment against control on one registered metric. There is nothing to correct, and
    // bh.ts is never called, so the stored label must not claim a procedure ran.
    expect(correctionFor("confirmatory", 1)).toBe("not_applied");
  });

  it("labels an entry registered after launch exploratory, whatever the count", () => {
    expect(correctionFor("exploratory", 1)).toBe("exploratory_label");
    expect(correctionFor("exploratory", 5)).toBe("exploratory_label");
  });

  it("treats an entry with no type yet as not corrected", () => {
    expect(correctionFor(null, 1)).toBe("not_applied");
  });

  it("refuses more than one comparison, because no screen runs a correction across a family yet", () => {
    // Writing benjamini_hochberg here would repeat the original fault. A screen that compares several groups must
    // call benjaminiHochberg and choose its own label.
    expect(() => correctionFor("confirmatory", 2)).toThrow(RangeError);
    expect(() => correctionFor("confirmatory", 0)).toThrow(RangeError);
    expect(() => correctionFor("confirmatory", 1.5)).toThrow(RangeError);
  });

  it("only ever returns a label the ledger accepts", () => {
    for (const type of ["confirmatory", "exploratory", null] as const) {
      expect(CORRECTION_METHODS).toContain(correctionFor(type, 1));
    }
    expect(CORRECTION_METHODS).toContain("not_applied");
  });
});

describe("correctionLine: the plain sentence shown with a result", () => {
  it("says one comparison needs no correction", () => {
    expect(correctionLine("not_applied", 1)).toBe(
      "Comparisons made: 1. No multiple comparison correction applies, because one comparison has nothing to correct.",
    );
  });

  it("says an exploratory result is labeled exploratory and not corrected", () => {
    const text = correctionLine("exploratory_label", 1);
    expect(text).toContain("Comparisons made: 1.");
    expect(text).toContain("exploratory");
    expect(text).toContain("not corrected");
  });

  it("says so when a stored result carries the old label with one comparison", () => {
    // Results saved before this change were labeled benjamini_hochberg with a count of 1. Nothing ran then.
    const text = correctionLine("benjamini_hochberg", 1);
    expect(text).toContain("Recorded as benjamini hochberg");
    expect(text).toContain("no correction ran");
    expect(text).toContain("nothing changed");
  });

  it("names the procedure and its assumption when it really was applied across several comparisons", () => {
    const text = correctionLine("benjamini_hochberg", 4);
    expect(text).toContain("Comparisons made: 4.");
    expect(text).toContain("Benjamini Hochberg");
    expect(text).toContain("independent or positively dependent");
  });

  it("does not claim a correction when no label was recorded", () => {
    expect(correctionLine(null, null)).toBe("No correction label was recorded.");
  });

  it("never uses an em dash or parentheses in what it shows", () => {
    for (const method of [...CORRECTION_METHODS, null] as const) {
      for (const n of [null, 0, 1, 4]) {
        expect(correctionLine(method, n)).not.toMatch(/[—()]/);
      }
    }
  });
});

describe("correctionShort: the table cell", () => {
  it("says not applied, with the count", () => {
    expect(correctionShort("not_applied", 1)).toBe("Not applied, 1 comparison");
  });

  it("says an exploratory result is not corrected", () => {
    expect(correctionShort("exploratory_label", 1)).toBe("Exploratory, not corrected, 1 comparison");
  });

  it("does not let an old benjamini_hochberg label with one comparison read as a real correction", () => {
    const text = correctionShort("benjamini_hochberg", 1);
    expect(text).toBe("Old label, no correction ran, 1 comparison");
    expect(text).not.toMatch(/Benjamini/);
  });

  it("names the procedure only when it ran across several comparisons", () => {
    expect(correctionShort("benjamini_hochberg", 3)).toBe("Benjamini Hochberg across 3 comparisons");
  });

  it("never uses an em dash or parentheses", () => {
    for (const m of CORRECTION_METHODS) for (const n of [1, 3]) expect(correctionShort(m, n)).not.toMatch(/[—()]/);
  });
});
