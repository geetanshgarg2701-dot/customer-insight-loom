import { describe, expect, it } from "vitest";
import { BlockedColumnError } from "./columns";
import {
  UnredactedQuoteError,
  createQuoteStore,
  isRedactedQuote,
  redactQuote,
  type RedactedQuote,
} from "./quote";

describe("redactQuote", () => {
  it("returns a stamped quote with identity data removed", () => {
    const q = redactQuote({
      text: "Mail jane@example.com or call 202-555-0143.",
      sourceColumn: "feedback",
    });
    expect(q.text).toBe("Mail [EMAIL] or call [PHONE].");
    expect(q.stamp.passed).toBe(true);
    expect(q.stamp.counts).toEqual({ email: 1, phone: 1, card: 0, address: 0, ssn: 0, ip: 0, name: 0 });
    expect(isRedactedQuote(q)).toBe(true);
  });

  it("refuses a quote that comes from a blocked identity column", () => {
    expect(() => redactQuote({ text: "anything", sourceColumn: "email" })).toThrow(
      BlockedColumnError,
    );
  });

  it("returns a frozen object", () => {
    const q = redactQuote({ text: "hello", sourceColumn: "comment" });
    expect(Object.isFrozen(q)).toBe(true);
  });
});

describe("quote store: an unredacted quote cannot be saved", () => {
  it("accepts a quote that went through redactQuote", () => {
    const store = createQuoteStore();
    store.saveQuote(redactQuote({ text: "Mail jane@example.com", sourceColumn: "comment" }));
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].text).toBe("Mail [EMAIL]");
  });

  it("rejects a plain quote at compile time and at run time", () => {
    const store = createQuoteStore();
    expect(() =>
      // @ts-expect-error a plain object has no redaction stamp, so it is not a RedactedQuote
      store.saveQuote({ text: "Mail jane@example.com", sourceColumn: "comment" }),
    ).toThrow(UnredactedQuoteError);
    expect(store.list()).toHaveLength(0);
  });

  it("rejects a forged cast at run time", () => {
    const store = createQuoteStore();
    const forged = {
      text: "Mail jane@example.com",
      sourceColumn: "comment",
      stamp: { passed: true, ruleVersion: "2", counts: { email: 0, phone: 0, card: 0, address: 0, ssn: 0, ip: 0 } },
    } as unknown as RedactedQuote;
    expect(() => store.saveQuote(forged)).toThrow(UnredactedQuoteError);
    expect(store.list()).toHaveLength(0);
  });

  it("rejects a copy of a real quote (a copy was not issued by redactQuote)", () => {
    const store = createQuoteStore();
    const real = redactQuote({ text: "hello", sourceColumn: "comment" });
    const copy = { ...real } as unknown as RedactedQuote;
    expect(() => store.saveQuote(copy)).toThrow(UnredactedQuoteError);
    const revived = JSON.parse(JSON.stringify(real)) as RedactedQuote;
    expect(() => store.saveQuote(revived)).toThrow(UnredactedQuoteError);
  });

  it("never stores the raw identity text", () => {
    const store = createQuoteStore();
    store.saveQuote(
      redactQuote({
        text: "card 4242 4242 4242 4242, mail jane@example.com",
        sourceColumn: "comment",
      }),
    );
    const stored = JSON.stringify(store.list());
    expect(stored).not.toContain("4242");
    expect(stored).not.toContain("jane@example.com");
  });
});
