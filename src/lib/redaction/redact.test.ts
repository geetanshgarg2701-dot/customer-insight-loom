import { describe, expect, it } from "vitest";
import { redact } from "./redact";

describe("redact: email", () => {
  it("replaces an email address with a placeholder", () => {
    const r = redact("Write to jane.doe@example.com today.");
    expect(r.text).toBe("Write to [EMAIL] today.");
    expect(r.findings).toEqual([{ type: "email", start: 9, end: 29 }]);
  });

  it("handles plus tags, subdomains and a trailing period", () => {
    expect(redact("a+promo@mail.example.org.").text).toBe("[EMAIL].");
  });

  it("leaves text without an address alone", () => {
    expect(redact("meet me @ noon").text).toBe("meet me @ noon");
  });
});

describe("redact: phone", () => {
  it.each([
    "202-555-0143",
    "(202) 555-0143",
    "202.555.0143",
    "202 555 0143",
    "2025550143",
    "+1 202 555 0143",
    "+44 20 7946 0123",
  ])("replaces %s", (phone) => {
    expect(redact(`Call ${phone} now`).text).toBe("Call [PHONE] now");
  });

  it("does not treat a short number as a phone", () => {
    expect(redact("order 12345 shipped").text).toBe("order 12345 shipped");
  });
});

describe("redact: card", () => {
  it("replaces a Luhn-valid number in groups of four", () => {
    expect(redact("card 4242 4242 4242 4242 ok").text).toBe("card [CARD] ok");
  });

  it("replaces a Luhn-valid number with dashes or no separators", () => {
    expect(redact("4242-4242-4242-4242").text).toBe("[CARD]");
    expect(redact("4242424242424242").text).toBe("[CARD]");
  });

  it("replaces a 15 digit Amex style number", () => {
    expect(redact("3782 822463 10005").text).toBe("[CARD]");
  });

  it("does not replace a 16 digit number that fails the Luhn test", () => {
    const r = redact("tracking 4242 4242 4242 4241 here");
    expect(r.findings.filter((f) => f.type === "card")).toEqual([]);
  });
});

describe("redact: street address", () => {
  it.each([
    "123 Maple Street",
    "45 Cedar Hollow Ave",
    "7 Willow Rd.",
    "900 N Sample Avenue",
    "12 5th Street",
    "88 Maple Street, Apt 4B",
    "PO Box 1234",
    "P.O. Box 77",
    "12 maple street",
  ])("replaces %s", (addr) => {
    expect(redact(`Ship to ${addr} please`).text).toBe("Ship to [ADDRESS] please");
  });

  it("redacts a whole PO box even when the sentence also contains a street-like word", () => {
    expect(redact("I moved and now live at PO Box 79684 in the new place.").text).toBe(
      "I moved and now live at [ADDRESS] in the new place.",
    );
  });

  it("keeps the sentence period after a full street word", () => {
    expect(redact("I live at 12 Maple Street.").text).toBe("I live at [ADDRESS].");
  });

  it("does not use the tail of a phone number as a house number", () => {
    expect(redact("202-555-0143 12 Maple Street").text).toBe("[PHONE] [ADDRESS]");
  });

  it("does not replace a number that is not followed by a street word", () => {
    expect(redact("I have 3 apples").text).toBe("I have 3 apples");
  });
});

describe("redact: general behavior", () => {
  it("handles several types in one text", () => {
    const r = redact(
      "Mail jane@example.com or call 202-555-0143, card 4242424242424242, home 12 Maple Street.",
    );
    expect(r.text).toBe("Mail [EMAIL] or call [PHONE], card [CARD], home [ADDRESS].");
    expect(r.findings.map((f) => f.type)).toEqual(["email", "phone", "card", "address"]);
  });

  it("reports offsets into the original text and never stores the matched value", () => {
    const original = "x jane@example.com y";
    const r = redact(original);
    for (const f of r.findings) {
      expect(Object.keys(f).sort()).toEqual(["end", "start", "type"]);
    }
    expect(original.slice(r.findings[0].start, r.findings[0].end)).toBe("jane@example.com");
  });

  it("counts findings per type", () => {
    const r = redact("a@example.com b@example.com 202-555-0143");
    expect(r.counts).toEqual({ email: 2, phone: 1, card: 0, address: 0 });
  });

  it("a card number is not also reported as a phone", () => {
    const r = redact("4242424242424242");
    expect(r.findings.map((f) => f.type)).toEqual(["card"]);
  });

  it("is idempotent: redacting redacted text changes nothing", () => {
    const once = redact("jane@example.com 202-555-0143 12 Maple Street").text;
    const twice = redact(once);
    expect(twice.text).toBe(once);
    expect(twice.findings).toEqual([]);
  });

  it("returns empty input unchanged", () => {
    expect(redact("")).toEqual({
      text: "",
      findings: [],
      counts: { email: 0, phone: 0, card: 0, address: 0 },
    });
  });

  it("does NOT cover names (documented limit of the rule set)", () => {
    expect(redact("My name is Jane Doe and I live nearby.").text).toBe(
      "My name is Jane Doe and I live nearby.",
    );
  });
});
