import { describe, expect, it } from "vitest";
import { syntheticJourneys } from "../demo/journeys";
import { PAINS, PAIN_LABELS, syntheticComments, TEST_CARD } from "./comments";

const journeys = syntheticJourneys(20_000, 11);
const comments = syntheticComments(journeys, 3_000, 17);

const share = (list: { pain: string }[], pain: string) => list.filter((c) => c.pain === pain).length / Math.max(1, list.length);

describe("syntheticComments, the shape", () => {
  it("is identical for the same seed and different for another", () => {
    expect(syntheticComments(journeys, 300, 5)).toEqual(syntheticComments(journeys, 300, 5));
    expect(syntheticComments(journeys, 300, 5)).not.toEqual(syntheticComments(journeys, 300, 6));
  });

  it("makes the number asked for, each from a different real journey customer, with that customer's segment, channel and outcome", () => {
    expect(comments).toHaveLength(3_000);
    expect(new Set(comments.map((c) => c.customer)).size).toBe(3_000);
    for (const c of comments) {
      const j = journeys[c.customer];
      expect([c.segment, c.channel, c.reached]).toEqual([j.segment, j.channel, j.reached]);
    }
  });

  it("gives every comment a known pain with a label, a severity from 1 to 3, and text with no em dash or parentheses", () => {
    for (const c of comments) {
      expect(PAINS).toContain(c.pain);
      expect([1, 2, 3]).toContain(c.severity);
      expect(c.text.length).toBeGreaterThan(10);
      expect(c.text).not.toMatch(/[—()]/);
    }
    for (const p of PAINS) expect(PAIN_LABELS[p]).toBeTruthy();
  });

  it("asks for consent on about 85 percent of comments", () => {
    const rate = comments.filter((c) => c.consent).length / comments.length;
    expect(rate).toBeGreaterThan(0.82);
    expect(rate).toBeLessThan(0.88);
  });

  it("refuses a count above the number of customers, or a count below 1", () => {
    expect(() => syntheticComments(journeys, 20_001, 1)).toThrow(RangeError);
    expect(() => syntheticComments(journeys, 0, 1)).toThrow(RangeError);
  });
});

describe("syntheticComments, the planted facts the evidence chain will have to find", () => {
  const leftAtCart = comments.filter((c) => c.reached === "Cart");
  const usedSupport = comments.filter((c) => journeys[c.customer].path.includes("Support"));
  const bought = comments.filter((c) => c.reached === "Purchase");
  const notBought = comments.filter((c) => c.reached !== "Purchase");

  it("has customers who left at the Cart mention shipping cost at least twice as often as everyone", () => {
    expect(share(leftAtCart, "shipping_cost")).toBeGreaterThan(2 * share(comments, "shipping_cost"));
  });

  it("has customers who used Support mention slow support far more often than everyone", () => {
    expect(share(usedSupport, "support_slow")).toBeGreaterThan(3 * share(comments, "support_slow"));
  });

  it("has customers who bought mention slow delivery more often than those who did not", () => {
    expect(share(bought, "slow_delivery")).toBeGreaterThan(share(notBought, "slow_delivery") * 2);
  });

  it("has new customers mention shipping cost more often than returning ones, by the planted factor", () => {
    const rate = (segment: string) => share(comments.filter((c) => c.segment === segment), "shipping_cost");
    expect(rate("new")).toBeGreaterThan(rate("returning"));
  });
});

describe("syntheticComments, the fake personal details", () => {
  const count = (re: RegExp, text: string) => (text.match(re) ?? []).length;

  it("plants emails only on the reserved .invalid domain, so no address can reach a real person", () => {
    for (const c of comments) {
      expect(count(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/g, c.text)).toBe(c.planted.email);
      if (c.planted.email > 0) expect(c.text).toContain("@example.invalid");
      expect(c.text).not.toMatch(/@(?!example\.invalid)[A-Za-z]/);
    }
  });

  it("plants phones only in the reserved 555 range, and a card only as the published test number", () => {
    for (const c of comments) {
      expect(count(/\(501\) 555-01\d\d|501-555-01\d\d/g, c.text)).toBe(c.planted.phone);
      expect(count(new RegExp(TEST_CARD, "g"), c.text)).toBe(c.planted.card);
    }
    expect(TEST_CARD).toBe("4242 4242 4242 4242");
  });

  it("plants street addresses and invented names, and records how many of each", () => {
    for (const c of comments) {
      expect(count(/\b\d{1,3} [A-Z][a-z]+ (?:Street|Avenue|Road)\b/g, c.text)).toBe(c.planted.address);
      expect(count(/Thanks, [A-Z][a-z]+ [A-Z][a-z]+/g, c.text)).toBe(c.planted.name);
    }
  });

  it("plants a meaningful share of each kind, so the redaction score has something to score", () => {
    const total = (k: "email" | "phone" | "card" | "address" | "name") => comments.reduce((n, c) => n + c.planted[k], 0);
    expect(total("email")).toBeGreaterThan(300);
    expect(total("phone")).toBeGreaterThan(150);
    expect(total("card")).toBeGreaterThan(40);
    expect(total("address")).toBeGreaterThan(40);
    expect(total("name")).toBeGreaterThan(200);
  });
});
