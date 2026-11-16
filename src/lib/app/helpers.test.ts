import { describe, expect, it } from "vitest";
import { guessColumn } from "./columns";
import { formatPercent, formatPoints, formatSignedPoints } from "./format";

describe("guessColumn", () => {
  const headers = ["Customer ID", "E-mail", "Group", "Converted", "Notes"];

  it("finds a column by a pattern, ignoring case and punctuation", () => {
    expect(guessColumn(headers, /e-?mail/i)).toBe(1);
    expect(guessColumn(headers, /group|arm/i)).toBe(2);
    expect(guessColumn(headers, /convert/i)).toBe(3);
  });

  it("returns the first match", () => {
    expect(guessColumn(["email_sent", "email"], /email/i)).toBe(0);
  });

  it("returns -1 when nothing matches", () => {
    expect(guessColumn(headers, /revenue/i)).toBe(-1);
    expect(guessColumn([], /email/i)).toBe(-1);
  });
});

describe("number formatting", () => {
  it("formats a proportion as a percent", () => {
    expect(formatPercent(0.12345)).toBe("12.35 percent");
    expect(formatPercent(0.5, 0)).toBe("50 percent");
    expect(formatPercent(0)).toBe("0.00 percent");
  });

  it("formats a difference of proportions as percentage points", () => {
    expect(formatPoints(0.02)).toBe("2.00 points");
    expect(formatPoints(0.0125, 1)).toBe("1.3 points");
  });

  it("signs a lift and avoids a minus zero", () => {
    expect(formatSignedPoints(0.02)).toBe("+2.00 points");
    expect(formatSignedPoints(-0.015)).toBe("-1.50 points");
    expect(formatSignedPoints(0)).toBe("0.00 points");
    expect(formatSignedPoints(-0.00001)).toBe("0.00 points");
  });

  it("shows a dash for a value that is not a number", () => {
    expect(formatPercent(Number.NaN)).toBe("not available");
    expect(formatPoints(Number.POSITIVE_INFINITY)).toBe("not available");
  });
});
