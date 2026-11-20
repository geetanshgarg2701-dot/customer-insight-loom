import { describe, expect, it } from "vitest";
import { syntheticJourneys } from "../demo/journeys";
import { isRedactedQuote } from "../redaction/quote";
import { syntheticComments, TEST_CARD } from "./comments";
import { prepareComments, reRedact } from "./prepare";

const journeys = syntheticJourneys(20_000, 11);
const comments = syntheticComments(journeys, 3_000, 17);
const prepared = prepareComments(comments);

const sum = (k: "email" | "phone" | "card" | "address" | "name") => comments.reduce((n, c) => n + c.planted[k], 0);

describe("prepareComments, what is kept and what is withheld", () => {
  it("keeps only comments with consent, and counts the rest as withheld", () => {
    const consented = comments.filter((c) => c.consent).length;
    expect(prepared.rows).toHaveLength(consented);
    expect(prepared.withheld).toBe(comments.length - consented);
    expect(prepared.rows.length + prepared.withheld).toBe(comments.length);
  });

  it("keeps each row tied to its customer, with the pain and severity unchanged", () => {
    for (const r of prepared.rows) {
      const c = comments.find((x) => x.customer === r.customer)!;
      expect([r.pain, r.severity, r.segment, r.channel, r.reached]).toEqual([c.pain, c.severity, c.segment, c.channel, c.reached]);
    }
  });

  it("holds only quotes the redaction step issued", () => {
    for (const r of prepared.rows) expect(isRedactedQuote(r.quote)).toBe(true);
  });
});

describe("prepareComments, the redaction scorecard", () => {
  it("catches every planted email, phone, card and address, so none is missed", () => {
    for (const k of ["email", "phone", "card", "address"] as const) {
      expect(prepared.scorecard[k].planted).toBe(sum(k));
      expect(prepared.scorecard[k].caught).toBe(sum(k));
      expect(prepared.scorecard[k].missed).toBe(0);
    }
  });

  it("catches every planted name in the generator, which only uses the easy sign-off form", () => {
    expect(prepared.scorecard.name.planted).toBe(sum("name"));
    expect(prepared.scorecard.name.caught).toBe(sum("name"));
    expect(prepared.scorecard.name.missed).toBe(0);
    expect(prepared.scorecard.name.coveredByRules).toBe(true);
  });

  it("leaves no planted name in any stored text", () => {
    for (const r of prepared.rows) expect(r.quote.text).not.toMatch(/Thanks, [A-Z][a-z]+ [A-Z][a-z]+/);
  });

  it("leaves no planted detail in any stored text", () => {
    for (const r of prepared.rows) {
      expect(r.quote.text).not.toContain("@example.invalid");
      expect(r.quote.text).not.toContain(TEST_CARD);
      expect(r.quote.text).not.toMatch(/555-01\d\d/);
      expect(r.quote.text).not.toMatch(/\b\d{1,3} [A-Z][a-z]+ (?:Street|Avenue|Road)\b/);
    }
  });

  it("counts a card placeholder in a stored text for each planted card in a consented comment", () => {
    const placed = prepared.rows.reduce((n, r) => n + (r.quote.text.match(/\[CARD\]/g) ?? []).length, 0);
    const planted = comments.filter((c) => c.consent).reduce((n, c) => n + c.planted.card, 0);
    expect(placed).toBe(planted);
  });
});

describe("reRedact, the correction step", () => {
  const first = prepared.rows[0];

  it("redacts an edit that adds a new email, and issues a fresh quote", () => {
    const edited = reRedact(first, `${first.quote.text} Write to new.person@example.invalid please.`);
    expect(edited.quote.text).not.toContain("@example.invalid");
    expect(edited.quote.text).toContain("[EMAIL]");
    expect(isRedactedQuote(edited.quote)).toBe(true);
    expect(edited.customer).toBe(first.customer);
  });

  it("keeps an edit that only removes words", () => {
    const edited = reRedact(first, "Short.");
    expect(edited.quote.text).toBe("Short.");
  });

  it("does not change the original row", () => {
    const before = first.quote.text;
    reRedact(first, "Something else entirely.");
    expect(first.quote.text).toBe(before);
  });

  it("refuses an edit over the length limit rather than cutting it", () => {
    expect(() => reRedact(first, "x".repeat(20_001))).toThrow();
  });
});
