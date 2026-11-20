import { DEFAULT_CAP, type EmailCheckInput } from "./rules";

/** Every field empty or unticked, as the email check screen starts. */
export const EMPTY_EMAIL: EmailCheckInput = {
  kind: "marketing",
  fromAddress: "",
  subject: "",
  body: "",
  listUnsubscribe: "",
  listUnsubscribePost: "",
  dailyToGmail: 0,
  unsubscribeDays: null,
  spamRatePercent: null,
  sendsPerCustomer7Days: 1,
  cap: DEFAULT_CAP,
  euOrCanada: false,
  attest: {
    subjectHonest: false,
    headersHonest: false,
    adDisclosed: false,
    optOutWorks30Days: false,
    audienceExcludes: false,
    spfOrDkim: false,
    spfAndDkim: false,
    dmarc: false,
  },
};

/**
 * A synthetic email that passes every rule, on reserved example domains so nothing in it can reach anyone. The screen
 * fills it in on request, and the demo ledger passes it before launching its entries.
 */
export const SYNTHETIC_EMAIL: EmailCheckInput = {
  ...EMPTY_EMAIL,
  fromAddress: "news@shop.example.com",
  subject: "Free shipping on orders over 50 dollars this week",
  body:
    "Advertisement from Shop Example.\n\nOrders over 50 dollars ship free until Sunday.\n\n" +
    "Shop Example, 100 Harbor Street, Springfield\nUnsubscribe or manage your email preferences at any time.",
  listUnsubscribe: "<https://shop.example.com/unsubscribe?u=demo>",
  listUnsubscribePost: "List-Unsubscribe=One-Click",
  dailyToGmail: 12_000,
  unsubscribeDays: 1,
  spamRatePercent: 0.05,
  sendsPerCustomer7Days: 2,
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
