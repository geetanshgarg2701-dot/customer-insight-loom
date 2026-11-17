import { describe, expect, it, vi } from "vitest";

// The check that redactQuote re-runs redaction on its own output could not be triggered with the real rules,
// because redaction is idempotent. This test replaces redact so the second pass still finds something, which is
// the situation the check exists for. Review finding R3-8.
let calls = 0;
vi.mock("./redact", () => ({
  redact: (text: string) => {
    calls++;
    const leftover = calls % 2 === 0 ? [{ type: "email", start: 0, end: 1 }] : [];
    return {
      text,
      findings: leftover,
      counts: { email: 0, phone: 0, card: 0, address: 0, ssn: 0, ip: 0 },
    };
  },
}));

describe("redactQuote clean output check", () => {
  it("refuses to issue a stamp when a second pass still finds something", async () => {
    const { redactQuote, isRedactedQuote } = await import("./quote");
    calls = 0;
    let issued: unknown = null;
    expect(() => {
      issued = redactQuote({ text: "hello", sourceColumn: "comment" });
    }).toThrow(/did not produce clean text/);
    expect(issued).toBeNull();
    expect(isRedactedQuote(issued)).toBe(false);
  });
});
