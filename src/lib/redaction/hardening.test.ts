import { describe, expect, it } from "vitest";
import { BlockedColumnError, assertColumnAllowed, isBlockedColumn } from "./columns";
import {
  MAX_QUOTE_CHARS,
  QuoteTooLongError,
  SourceColumnError,
  createQuoteStore,
  redactQuote,
  type StoredQuote,
} from "./quote";
import { redact } from "./redact";
import { RULE_VERSION } from "./types";

// Characters are built from code points so no invisible character sits in this file.
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const CYRILLIC_A = String.fromCharCode(0x0430);
const E_ACUTE = String.fromCharCode(0x00e9);
const A_UMLAUT = String.fromCharCode(0x00e4);
const FULLWIDTH_AT = String.fromCharCode(0xff20);
const CJK_USER = String.fromCharCode(0x7528, 0x6237);

describe("email: unicode, invisible characters and encodings leave no stub", () => {
  it.each([
    ["plain", "write to jane.doe@example.com now", "write to [EMAIL] now"],
    ["a lookalike letter in the local part", `write to j${CYRILLIC_A}ne.doe@example.com`, "write to [EMAIL]"],
    ["a zero width space before the at sign", `jane.doe${ZERO_WIDTH_SPACE}@example.com`, "[EMAIL]"],
    ["a zero width space inside the domain", `jane@exam${ZERO_WIDTH_SPACE}ple.com`, "[EMAIL]"],
    ["an accented local part", `write to jan${E_ACUTE}@example.com`, "write to [EMAIL]"],
    ["an internationalized domain", `write to jane@ex${A_UMLAUT}mple.com`, "write to [EMAIL]"],
    ["a CJK local part", `write to ${CJK_USER}@example.com`, "write to [EMAIL]"],
    ["a percent encoded at sign", "write to jane.doe%40example.com", "write to [EMAIL]"],
    ["a full width at sign", `jane${FULLWIDTH_AT}example.com`, "[EMAIL]"],
    ["a trailing period", "mail jane@example.com.", "mail [EMAIL]."],
    ["a comma after", "jane@example.com, thanks", "[EMAIL], thanks"],
    ["a tag and a long domain", "a.b+tag@mail.example.co.uk", "[EMAIL]"],
  ])("%s", (_label, input, expected) => {
    expect(redact(input).text).toBe(expected);
  });

  it.each([
    "50%40off",
    "a@b",
    "@jane_doe",
    "user@",
    "jane@example",
    "hello @ world",
    "email me @ noon",
    "price 20% off, 100@5",
  ])("leaves %s alone", (text) => {
    expect(redact(text).findings.filter((f) => f.type === "email")).toEqual([]);
  });

  it("is idempotent for every unicode case", () => {
    const text = `j${CYRILLIC_A}ne@example.com and jane.doe${ZERO_WIDTH_SPACE}@example.com and jane%40example.com`;
    const once = redact(text).text;
    expect(redact(once).text).toBe(once);
  });
});

describe("card: any 13 to 19 digit run is redacted, with or without a valid checksum", () => {
  it.each([
    ["a number that fails the checksum", "my card 4242 4242 4242 4243 was declined", "my card [CARD] was declined"],
    ["two spaces between groups", "card 4111  1111 1111 1111 declined", "card [CARD] declined"],
    ["dots between groups", "card 4111.1111.1111.1111 declined", "card [CARD] declined"],
    ["dashes between groups", "4111-1111-1111-1111", "[CARD]"],
    ["13 digits", "1234567890123", "[CARD]"],
    ["19 digits", "1234567890123456789", "[CARD]"],
    ["a valid test card", "card 4242 4242 4242 4242 ok", "card [CARD] ok"],
  ])("%s", (_label, input, expected) => {
    expect(redact(input).text).toBe(expected);
  });

  it("leaves 12 digit and 20 digit runs alone, which are not card shaped", () => {
    expect(redact("order 123456789012 shipped").text).toBe("order 123456789012 shipped");
    expect(redact("id 12345678901234567890 saved").text).toBe("id 12345678901234567890 saved");
  });

  it("does not read a phone number as a card", () => {
    expect(redact("call +1 415 555 0132").findings.map((f) => f.type)).toEqual(["phone"]);
  });
});

describe("social security number", () => {
  it.each([
    ["with dashes", "My SSN is 123-45-6789 please", "My SSN is [SSN] please"],
    ["with spaces", "SSN 123 45 6789 on file", "SSN [SSN] on file"],
  ])("%s", (_label, input, expected) => {
    const r = redact(input);
    expect(r.text).toBe(expected);
    expect(r.findings.map((f) => f.type)).toEqual(["ssn"]);
  });

  it("leaves nine bare digits, a date and a phone number alone or as a phone", () => {
    expect(redact("order 123456789 shipped").text).toBe("order 123456789 shipped");
    expect(redact("on 2026-11-16 we sent").text).toBe("on 2026-11-16 we sent");
    expect(redact("202-555-0143").findings.map((f) => f.type)).toEqual(["phone"]);
  });
});

describe("IPv4 address", () => {
  it.each([
    ["a plain address", "I logged in from 192.168.1.20 yesterday", "I logged in from [IP] yesterday"],
    ["a sentence period after it", "it was 10.0.0.1.", "it was [IP]."],
    ["leading zeros", "host 010.001.001.001 down", "host [IP] down"],
  ])("%s", (_label, input, expected) => {
    const r = redact(input);
    expect(r.text).toBe(expected);
    expect(r.findings.map((f) => f.type)).toEqual(["ip"]);
  });

  it.each(["999.1.1.1", "1.2.3.4.5", "version 1.2.3", "256.256.256.256", "3.14159"])(
    "leaves %s alone",
    (text) => {
      expect(redact(text).findings.filter((f) => f.type === "ip")).toEqual([]);
    },
  );

  it("counts the new types", () => {
    expect(redact("123-45-6789 and 192.168.1.20").counts).toEqual({
      email: 0,
      phone: 0,
      card: 0,
      address: 0,
      ssn: 1,
      ip: 1,
      name: 0,
    });
  });
});

describe("time is linear in the input, so a long token cannot freeze the page", () => {
  const long = (unit: string, times: number) => unit.repeat(times);
  it.each([
    ["one long token", long("a", 200_000)],
    ["a dotted token", long("a.", 100_000)],
    ["many at signs", long("@", 200_000)],
    ["a at a at", long("a@", 100_000)],
    ["a long local part and one at sign", long("a", 150_000) + "@example.com"],
    ["digits and spaces", long("1 ", 100_000)],
    ["digits and dashes", long("1-", 100_000)],
    ["a digit run", long("1", 200_000)],
    ["dotted digits", long("1.", 100_000)],
    ["spaces", long(" ", 200_000)],
    ["street shaped words", long("12 ", 60_000)],
  ])("%s", { timeout: 30_000 }, (_label, text) => {
    const started = performance.now();
    redact(text);
    expect(performance.now() - started).toBeLessThan(3000);
  });
});

describe("column rule", () => {
  it.each([
    "jane@example.com",
    "555-123-4567",
    "4111 1111 1111 1111",
    "123-45-6789",
    "192.168.1.20",
    "ip_address",
    "email_sent_count",
  ])("blocks %s", (name) => {
    expect(isBlockedColumn(name)).toBe(true);
  });

  it.each(["campaign_name", "product_name", "comment", "Order Date", "score"])("allows %s", (name) => {
    expect(isBlockedColumn(name)).toBe(false);
  });

  it("never repeats the column text in its error", () => {
    for (const name of ["Mail: jane.doe@example.com", "jane.doe@example.com", "email"]) {
      let error: unknown;
      try {
        assertColumnAllowed(name);
      } catch (caught) {
        error = caught;
      }
      expect(error, name).toBeInstanceOf(BlockedColumnError);
      expect((error as Error).message).not.toContain("jane");
      expect((error as Error).message).not.toContain("example");
      expect(JSON.stringify(error)).not.toContain("jane");
      expect(Object.values(error as object).join(" ")).not.toContain("jane");
    }
  });
});

describe("redactQuote refuses what it cannot make safe", () => {
  it("refuses a source column that looks like personal data, without repeating it", () => {
    for (const sourceColumn of [
      "notes for jane.doe@example.com",
      "call 202-555-0143",
      "card 4242 4242 4242 4242",
      "ssn 123-45-6789",
      "from 192.168.1.20",
    ]) {
      let error: unknown;
      try {
        redactQuote({ text: "fine", sourceColumn });
      } catch (caught) {
        error = caught;
      }
      expect(error, sourceColumn).toBeInstanceOf(SourceColumnError);
      expect((error as Error).message).not.toMatch(/jane|202|4242|123-45|192\.168/);
    }
  });

  it("refuses a very long source column", () => {
    expect(() => redactQuote({ text: "fine", sourceColumn: "c".repeat(201) })).toThrow(SourceColumnError);
    expect(redactQuote({ text: "fine", sourceColumn: "c".repeat(200) }).sourceColumn).toHaveLength(200);
  });

  it("refuses text past the length cap instead of cutting it, and says so", () => {
    const over = "word ".repeat(MAX_QUOTE_CHARS / 5 + 1);
    expect(over.length).toBeGreaterThan(MAX_QUOTE_CHARS);
    expect(() => redactQuote({ text: over, sourceColumn: "comment" })).toThrow(QuoteTooLongError);
    const atCap = "word ".repeat(MAX_QUOTE_CHARS / 5);
    expect(atCap.length).toBe(MAX_QUOTE_CHARS);
    expect(redactQuote({ text: atCap, sourceColumn: "comment" }).text).toBe(atCap);
  });

  it("redacts a long quote quickly", { timeout: 30_000 }, () => {
    const started = performance.now();
    redactQuote({ text: "a".repeat(MAX_QUOTE_CHARS), sourceColumn: "comment" });
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("stamps the new rule version", () => {
    expect(RULE_VERSION).toBe("3");
    expect(redactQuote({ text: "hello", sourceColumn: "comment" }).stamp.ruleVersion).toBe("3");
  });

  it("redacts the new types inside a quote", () => {
    const q = redactQuote({ text: "ssn 123-45-6789 from 192.168.1.20", sourceColumn: "comment" });
    expect(q.text).toBe("ssn [SSN] from [IP]");
    expect(q.stamp.counts).toMatchObject({ ssn: 1, ip: 1 });
  });
});

describe("the quote store cannot be edited from outside", () => {
  it("hands out a frozen copy, so nothing can be pushed in or changed after saving", () => {
    const store = createQuoteStore();
    store.saveQuote(redactQuote({ text: "hello", sourceColumn: "comment" }));
    const list = store.list();

    expect(() => (list as unknown as StoredQuote[]).push({ text: "raw", sourceColumn: "x", ruleVersion: "2" })).toThrow(
      TypeError,
    );
    expect(() => {
      (list[0] as { text: string }).text = "tampered jane@example.com";
    }).toThrow(TypeError);

    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].text).toBe("hello");
  });

  it("gives a new array each time, so holding an old one shows nothing new", () => {
    const store = createQuoteStore();
    const before = store.list();
    store.saveQuote(redactQuote({ text: "one", sourceColumn: "comment" }));
    expect(before).toHaveLength(0);
    expect(store.list()).toHaveLength(1);
  });
});
