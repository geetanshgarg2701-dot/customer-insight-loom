import { describe, expect, it } from "vitest";
import { BULK_PER_DAY, checkEmail, DEFAULT_CAP, type EmailCheckInput, type RuleRow } from "./rules";

const GOOD: EmailCheckInput = {
  kind: "marketing",
  fromAddress: "news@shop.example.com",
  subject: "Our autumn sale starts today",
  body: "Advertisement. Twenty percent off coats.\nShop Example, 100 Harbor Street, Springfield\nUnsubscribe at any time.",
  listUnsubscribe: "<https://shop.example.com/unsub?u=1>, <mailto:unsub@shop.example.com>",
  listUnsubscribePost: "List-Unsubscribe=One-Click",
  dailyToGmail: 20_000,
  unsubscribeDays: 1,
  spamRatePercent: 0.05,
  sendsPerCustomer7Days: 2,
  cap: DEFAULT_CAP,
  euOrCanada: false,
  attest: {
    subjectHonest: true,
    headersHonest: true,
    adDisclosed: true,
    optOutWorks30Days: true,
    audienceExcludes: true,
    spfOrDkim: true,
    spfAndDkim: true,
    dmarc: true,
  },
};

const row = (rows: RuleRow[], id: string) => {
  const r = rows.find((x) => x.id === id);
  if (!r) throw new Error(`no row ${id}`);
  return r;
};

describe("checkEmail, a compliant bulk marketing email", () => {
  it("is approved, and every row names its source, its checked date and its tier", () => {
    const r = checkEmail(GOOD);
    expect(r.approved).toBe(true);
    expect(r.blocking).toEqual([]);
    for (const x of r.rows) {
      expect(x.source.length, x.id).toBeGreaterThan(0);
      expect(x.checked, x.id).toBe("2026-11-19");
      expect(["fail"]).not.toContain(x.status);
    }
    expect(row(r.rows, "penalty").detail).toContain("53,088 dollars");
  });

  it("sets the defaults the plan names: a cap of 4 a week and bulk from 5,000 a day to Gmail", () => {
    expect(DEFAULT_CAP).toBe(4);
    expect(BULK_PER_DAY).toBe(5_000);
  });
});

describe("checkEmail, each tier 1 rule blocks approval when it fails", () => {
  const cases: [string, Partial<EmailCheckInput>, string][] = [
    ["no opt out wording in the body", { body: "Advertisement. Shop Example, 100 Harbor Street, Springfield" }, "unsubscribe-link"],
    ["no postal address", { body: "Advertisement. Unsubscribe here." }, "postal-address"],
    ["unsubscribes take 15 days", { unsubscribeDays: 15 }, "unsubscribe-10-days"],
    ["a subject that pretends to be a reply", { subject: "Re: your order" }, "honest-subject"],
    ["a From address that is not an address", { fromAddress: "news at shop" }, "honest-headers"],
  ];
  for (const [what, change, id] of cases) {
    it(`blocks on ${what}`, () => {
      const r = checkEmail({ ...GOOD, ...change });
      expect(row(r.rows, id).status).toBe("fail");
      expect(r.approved).toBe(false);
      expect(r.blocking).toContain(id);
    });
  }

  it("blocks until each statement only a person can make is ticked", () => {
    for (const key of ["subjectHonest", "headersHonest", "adDisclosed", "optOutWorks30Days", "audienceExcludes"] as const) {
      const r = checkEmail({ ...GOOD, attest: { ...GOOD.attest, [key]: false } });
      expect(r.approved, key).toBe(false);
      expect(r.rows.some((x) => x.status === "needs" && r.blocking.includes(x.id)), key).toBe(true);
    }
  });

  it("accepts a PO box or a private mailbox as the postal address", () => {
    for (const body of ["Advertisement. PO Box 4471, Springfield. Unsubscribe.", "Advertisement. 12 Main St PMB 301, Springfield. Opt out here."]) {
      expect(row(checkEmail({ ...GOOD, body }).rows, "postal-address").status, body).toBe("pass");
    }
  });

  it("allows unsubscribes in up to 10 days, warns from 11 to 14 since that may still be 10 business days, fails after", () => {
    const at = (d: number) => row(checkEmail({ ...GOOD, dailyToGmail: 10, unsubscribeDays: d }).rows, "unsubscribe-10-days").status;
    expect([at(10), at(11), at(14), at(15)]).toEqual(["pass", "warn", "warn", "fail"]);
    expect(row(checkEmail({ ...GOOD, unsubscribeDays: null }).rows, "unsubscribe-10-days").status).toBe("needs");
  });
});

describe("checkEmail, bulk sender rules from Google and Yahoo", () => {
  it("treats 5,000 a day to Gmail as bulk and 4,999 as not", () => {
    const missing = { listUnsubscribe: "", listUnsubscribePost: "" };
    expect(row(checkEmail({ ...GOOD, ...missing, dailyToGmail: 5_000 }).rows, "one-click").status).toBe("fail");
    expect(row(checkEmail({ ...GOOD, ...missing, dailyToGmail: 4_999 }).rows, "one-click").status).toBe("not-applicable");
  });

  it("needs both one click headers, an https address and the exact post value", () => {
    const at = (c: Partial<EmailCheckInput>) => row(checkEmail({ ...GOOD, ...c }).rows, "one-click").status;
    expect(at({ listUnsubscribe: "<mailto:unsub@shop.example.com>" })).toBe("fail");
    expect(at({ listUnsubscribePost: "" })).toBe("fail");
    expect(at({ listUnsubscribePost: "list-unsubscribe=one-click" })).toBe("pass");
    expect(at({ listUnsubscribePost: "List-Unsubscribe=Yes" })).toBe("fail");
  });

  it("needs bulk unsubscribes handled within 2 days", () => {
    expect(row(checkEmail({ ...GOOD, unsubscribeDays: 2 }).rows, "unsubscribe-2-days").status).toBe("pass");
    const late = checkEmail({ ...GOOD, unsubscribeDays: 3 });
    expect(row(late.rows, "unsubscribe-2-days").status).toBe("fail");
    expect(late.approved).toBe(false);
    expect(row(checkEmail({ ...GOOD, dailyToGmail: 100, unsubscribeDays: 3 }).rows, "unsubscribe-2-days").status).toBe("not-applicable");
  });

  it("fails a spam rate of 0.3 percent or more, warns from the 0.1 percent target, and passes below it", () => {
    const at = (p: number) => row(checkEmail({ ...GOOD, spamRatePercent: p }).rows, "spam-rate").status;
    expect([at(0.09), at(0.1), at(0.29), at(0.3)]).toEqual(["pass", "warn", "warn", "fail"]);
  });

  it("asks for the spam rate, blocking for a bulk sender only", () => {
    expect(checkEmail({ ...GOOD, spamRatePercent: null }).approved).toBe(false);
    expect(checkEmail({ ...GOOD, dailyToGmail: 100, spamRatePercent: null }).approved).toBe(true);
  });

  it("shows authentication as a checklist that warns but never blocks, since the app cannot read DNS", () => {
    const r = checkEmail({ ...GOOD, attest: { ...GOOD.attest, spfAndDkim: false, dmarc: false, spfOrDkim: false } });
    expect(row(r.rows, "authentication").status).toBe("warn");
    expect(r.approved).toBe(true);
  });
});

describe("checkEmail, app policy and scope", () => {
  it("blocks over the frequency cap and labels it app policy, not law, and follows a changed cap", () => {
    const over = checkEmail({ ...GOOD, sendsPerCustomer7Days: 5 });
    expect(row(over.rows, "frequency-cap").status).toBe("fail");
    expect(row(over.rows, "frequency-cap").tier).toBe("policy");
    expect(row(over.rows, "frequency-cap").requirement).toMatch(/app policy, not law/i);
    expect(checkEmail({ ...GOOD, sendsPerCustomer7Days: 5, cap: 6 }).approved).toBe(true);
  });

  it("warns that GDPR and CASL checks are not built when recipients are in the EU or Canada", () => {
    expect(row(checkEmail({ ...GOOD, euOrCanada: true }).rows, "eu-canada").status).toBe("warn");
    expect(row(checkEmail(GOOD).rows, "eu-canada").status).toBe("not-applicable");
  });

  it("does not ask a transactional email for an opt out, an address, an ad label or one click, but still checks its headers", () => {
    const r = checkEmail({ ...GOOD, kind: "transactional", body: "Your order shipped.", listUnsubscribe: "", listUnsubscribePost: "", fromAddress: "bad" });
    for (const id of ["unsubscribe-link", "postal-address", "ad-identified", "one-click", "unsubscribe-2-days"]) {
      expect(row(r.rows, id).status, id).toBe("not-applicable");
    }
    expect(row(r.rows, "honest-headers").status).toBe("fail");
  });

  it("refuses numbers that make no sense", () => {
    expect(() => checkEmail({ ...GOOD, dailyToGmail: -1 })).toThrow(RangeError);
    expect(() => checkEmail({ ...GOOD, spamRatePercent: 101 })).toThrow(RangeError);
    expect(() => checkEmail({ ...GOOD, cap: 0 })).toThrow(RangeError);
    expect(() => checkEmail({ ...GOOD, unsubscribeDays: 1.5 })).toThrow(RangeError);
  });
});
