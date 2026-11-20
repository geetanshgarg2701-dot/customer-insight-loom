/**
 * The pre-send compliance check, plan section 6.6. Version 1 covers US commercial email under CAN-SPAM, plus the
 * Gmail and Yahoo sender requirements. Each row names its source and the date it was checked. Approval is blocked
 * when a row fails, or when a statement only a person can make is not ticked.
 *
 * Sources, all read on 2026-11-19:
 * - FTC, CAN-SPAM Act: A Compliance Guide for Business, edited January 2024 for the penalty figure.
 * - Google, Email sender guidelines, support.google.com/a/answer/81126. It gives no number of days for honoring an
 *   unsubscribe, so the 2 day rule cites Yahoo.
 * Addresses are kept without their scheme and shown as text, because the app names no outside address in code, which
 * the privacy test checks.
 * - Yahoo Sender Hub, Sender Requirements and Recommendations, senders.yahooinc.com/best-practices.
 *
 * This is not legal advice. It checks what can be checked from the email and the answers given.
 */
import { detectAddresses } from "../redaction/detectors";

export const CHECKED = "2026-11-19";
/** Google applies its bulk rules to senders of 5,000 or more messages a day to Gmail accounts. */
export const BULK_PER_DAY = 5_000;
/** No law sets a frequency cap. This default comes from the plan and is app policy. */
export const DEFAULT_CAP = 4;
const SPAM_LIMIT = 0.3;
const SPAM_TARGET = 0.1;

const FTC = {
  source: "FTC, CAN-SPAM Act: A Compliance Guide for Business",
  url: "www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business",
};
const GOOGLE = { source: "Google, Email sender guidelines", url: "support.google.com/a/answer/81126" };
const YAHOO = { source: "Yahoo Sender Hub, Sender Requirements and Recommendations", url: "senders.yahooinc.com/best-practices/" };
const APP = { source: "This app's own policy", url: "" };

export type EmailCheckInput = {
  kind: "marketing" | "transactional";
  fromAddress: string;
  subject: string;
  body: string;
  listUnsubscribe: string;
  listUnsubscribePost: string;
  /** Messages a day to Gmail accounts. */
  dailyToGmail: number;
  /** Calendar days to process an unsubscribe, or null when not known. */
  unsubscribeDays: number | null;
  /** Spam rate in percent, as Postmaster Tools reports it, or null when not known. */
  spamRatePercent: number | null;
  sendsPerCustomer7Days: number;
  cap: number;
  euOrCanada: boolean;
  attest: {
    subjectHonest: boolean;
    headersHonest: boolean;
    adDisclosed: boolean;
    optOutWorks30Days: boolean;
    audienceExcludes: boolean;
    spfOrDkim: boolean;
    spfAndDkim: boolean;
    dmarc: boolean;
  };
};

export type RuleStatus = "pass" | "fail" | "needs" | "warn" | "info" | "not-applicable";
export type RuleRow = {
  id: string;
  rule: string;
  requirement: string;
  source: string;
  url: string;
  checked: string;
  /** 1 is the law, 2 is a mailbox provider's requirement, policy is this app's choice. */
  tier: 1 | 2 | "policy" | "info";
  status: RuleStatus;
  detail: string;
  /** Whether a "needs" answer blocks approval. */
  blocksWhenUnanswered: boolean;
};
export type EmailCheck = { approved: boolean; bulk: boolean; rows: RuleRow[]; blocking: string[] };

const OPT_OUT = /\b(?:unsubscribe|opt[\s-]?out|stop receiving|manage (?:your )?(?:email )?preferences|email preferences)\b/i;
const PRIVATE_MAILBOX = /\bPMB\s*#?\s*\d+/i;
const EMAIL_SHAPE = /^[^\s@<>()",;]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const FAKE_REPLY = /^\s*(?:re|fw|fwd)\s*:/i;
const HTTPS_IN_BRACKETS = /<https:\/\/[^>\s]+>/i;

function checkNumber(value: number | null, label: string, opts: { integer?: boolean; min: number; max?: number }): void {
  if (value === null) return;
  const ok = Number.isFinite(value) && value >= opts.min && (opts.max === undefined || value <= opts.max) && (!opts.integer || Number.isInteger(value));
  if (!ok) throw new RangeError(`${label} is not a valid number.`);
}

export function checkEmail(input: EmailCheckInput): EmailCheck {
  checkNumber(input.dailyToGmail, "Messages a day", { integer: true, min: 0 });
  checkNumber(input.unsubscribeDays, "Days to process an unsubscribe", { integer: true, min: 0 });
  checkNumber(input.spamRatePercent, "Spam rate", { min: 0, max: 100 });
  checkNumber(input.sendsPerCustomer7Days, "Emails per customer in 7 days", { integer: true, min: 0 });
  checkNumber(input.cap, "Frequency cap", { integer: true, min: 1 });

  const marketing = input.kind === "marketing";
  const bulk = input.dailyToGmail >= BULK_PER_DAY;
  const a = input.attest;
  const rows: RuleRow[] = [];
  const add = (r: Omit<RuleRow, "checked" | "blocksWhenUnanswered"> & { blocksWhenUnanswered?: boolean }) =>
    rows.push({ checked: CHECKED, blocksWhenUnanswered: true, ...r });
  const na = (why: string) => ({ status: "not-applicable" as const, detail: why });
  const notMarketing = "Transactional and relationship messages are exempt from most CAN-SPAM rules.";

  add({
    id: "unsubscribe-link", rule: "Opt out offered", tier: 1, ...FTC,
    requirement: "Tell recipients how to opt out of future marketing email. Bulk senders must also show a visible unsubscribe link.",
    ...(!marketing ? na(notMarketing) : OPT_OUT.test(input.body)
      ? { status: "pass", detail: "The body has opt out wording." }
      : { status: "fail", detail: "No unsubscribe or opt out wording was found in the body." }),
  });
  add({
    id: "unsubscribe-10-days", rule: "Opt outs honored in time", tier: 1, ...FTC,
    requirement: "Honor an opt out within 10 business days.",
    ...(!marketing ? na(notMarketing) : input.unsubscribeDays === null
      ? { status: "needs", detail: "Say how many days it takes to process an unsubscribe." }
      : input.unsubscribeDays <= 10
        ? { status: "pass", detail: `${input.unsubscribeDays} days is within 10 business days.` }
        : input.unsubscribeDays <= 14
          ? { status: "warn", detail: `${input.unsubscribeDays} calendar days may still be within 10 business days. Check the weekends and holidays.` }
          : { status: "fail", detail: `${input.unsubscribeDays} calendar days is more than 10 business days.` }),
  });
  add({
    id: "optout-30-days", rule: "Opt out keeps working", tier: 1, ...FTC,
    requirement: "The opt out must keep working for at least 30 days after sending.",
    ...(!marketing ? na(notMarketing) : a.optOutWorks30Days
      ? { status: "pass", detail: "Confirmed by you." }
      : { status: "needs", detail: "Confirm the opt out will work for 30 days after sending." }),
  });
  add({
    id: "postal-address", rule: "Physical postal address", tier: 1, ...FTC,
    requirement: "Include a valid physical postal address. A registered PO box or private mailbox counts.",
    ...(!marketing ? na(notMarketing) : detectAddresses(input.body).length > 0 || PRIVATE_MAILBOX.test(input.body)
      ? { status: "pass", detail: "A postal address was found in the body." }
      : { status: "fail", detail: "No street address, PO box or private mailbox was found in the body." }),
  });
  const fromOk = EMAIL_SHAPE.test(input.fromAddress.trim());
  add({
    id: "honest-headers", rule: "Honest header information", tier: 1, ...FTC,
    requirement: "From, To, Reply-To and routing information must be accurate and identify the sender. This applies to every email.",
    ...(!fromOk
      ? { status: "fail", detail: "The From address is not a valid email address." }
      : a.headersHonest
        ? { status: "pass", detail: "The From address is well formed, and you confirmed the headers are accurate." }
        : { status: "needs", detail: "Confirm the From name and routing information identify who is sending." }),
  });
  const subject = input.subject.trim();
  add({
    id: "honest-subject", rule: "Honest subject line", tier: 1, ...FTC,
    requirement: "The subject line must not mislead about what the message is.",
    ...(subject === ""
      ? { status: "fail", detail: "The subject line is empty." }
      : FAKE_REPLY.test(subject)
        ? { status: "fail", detail: "The subject starts like a reply or a forward, which misleads when the email is neither." }
        : a.subjectHonest
          ? { status: "pass", detail: "Confirmed by you." }
          : { status: "needs", detail: "Confirm the subject line matches what the email is." }),
  });
  add({
    id: "ad-identified", rule: "Identified as an ad", tier: 1, ...FTC,
    requirement: "Disclose clearly and conspicuously that the message is an advertisement.",
    ...(!marketing ? na(notMarketing) : a.adDisclosed
      ? { status: "pass", detail: "Confirmed by you. The law sets no wording, so this cannot be checked from the text." }
      : { status: "needs", detail: "Confirm the email clearly says it is an advertisement." }),
  });
  add({
    id: "suppression-consent", rule: "Suppression and consent", tier: 1, ...FTC,
    requirement: "Opted out and unconsented people, and active holdout controls, are left out of the audience.",
    ...(!marketing ? na(notMarketing) : a.audienceExcludes
      ? { status: "pass", detail: "Confirmed by you." }
      : { status: "needs", detail: "Confirm the audience leaves out opted out people, people without consent, and holdout controls." }),
  });
  add({
    id: "penalty", rule: "What a violation costs", tier: "info", ...FTC,
    requirement: "Each separate email in violation can be fined.",
    status: "info", detail: "Up to 53,088 dollars per email, as the FTC guide states after its January 2024 inflation adjustment.",
    blocksWhenUnanswered: false,
  });

  const postOk = input.listUnsubscribePost.trim().toLowerCase() === "list-unsubscribe=one-click";
  const headerOk = HTTPS_IN_BRACKETS.test(input.listUnsubscribe);
  add({
    id: "one-click", rule: "One click unsubscribe", tier: 2, ...GOOGLE,
    requirement: `At ${BULK_PER_DAY.toLocaleString("en-US")} or more messages a day to Gmail, marketing mail needs List-Unsubscribe with an https address and List-Unsubscribe-Post: List-Unsubscribe=One-Click, RFC 2369 and RFC 8058.`,
    ...(!marketing ? na(notMarketing) : !bulk
      ? na(`Below ${BULK_PER_DAY.toLocaleString("en-US")} a day to Gmail it is not required, though it is recommended.`)
      : headerOk && postOk
        ? { status: "pass", detail: "Both headers are present." }
        : { status: "fail", detail: [!headerOk && "List-Unsubscribe has no https address in angle brackets.", !postOk && "List-Unsubscribe-Post is not List-Unsubscribe=One-Click."].filter(Boolean).join(" ") }),
  });
  add({
    id: "unsubscribe-2-days", rule: "Bulk unsubscribes within 2 days", tier: 2, ...YAHOO,
    requirement: "Bulk senders must honor unsubscribes within 2 days.",
    ...(!marketing ? na(notMarketing) : !bulk
      ? na("Applies to bulk senders.")
      : input.unsubscribeDays === null
        ? { status: "needs", detail: "Say how many days it takes to process an unsubscribe." }
        : input.unsubscribeDays <= 2
          ? { status: "pass", detail: `${input.unsubscribeDays} days.` }
          : { status: "fail", detail: `${input.unsubscribeDays} days is more than 2.` }),
  });
  add({
    id: "spam-rate", rule: "Spam rate", tier: 2, ...GOOGLE,
    requirement: `Keep the spam rate in Postmaster Tools below ${SPAM_LIMIT} percent, and aim below ${SPAM_TARGET} percent. Yahoo also sets ${SPAM_LIMIT} percent.`,
    blocksWhenUnanswered: bulk,
    ...(input.spamRatePercent === null
      ? { status: "needs", detail: bulk ? "Give the spam rate from Postmaster Tools." : "Give the spam rate if you know it. It is not blocking below bulk volume." }
      : input.spamRatePercent >= SPAM_LIMIT
        ? { status: "fail", detail: `${input.spamRatePercent} percent is at or above ${SPAM_LIMIT} percent.` }
        : input.spamRatePercent >= SPAM_TARGET
          ? { status: "warn", detail: `${input.spamRatePercent} percent is under the limit but above the ${SPAM_TARGET} percent target.` }
          : { status: "pass", detail: `${input.spamRatePercent} percent.` }),
  });
  const authOk = bulk ? a.spfAndDkim && a.dmarc : a.spfOrDkim || a.spfAndDkim;
  add({
    id: "authentication", rule: "Authentication", tier: 2, ...GOOGLE,
    requirement: bulk
      ? "Bulk senders need SPF and DKIM, and DMARC with at least p=none, with the From domain aligned."
      : "All senders need SPF or DKIM.",
    status: authOk ? "pass" : "warn",
    detail: authOk
      ? "Confirmed by you. The app cannot read your DNS records."
      : "A checklist item, not a block, because the app cannot read your DNS. Check your records with your email provider.",
    blocksWhenUnanswered: false,
  });
  add({
    id: "frequency-cap", rule: "Frequency cap", tier: "policy", ...APP,
    requirement: `At most ${input.cap} marketing emails per customer in 7 days, across all journeys. App policy, not law.`,
    ...(!marketing ? na("Applies to marketing email.") : input.sendsPerCustomer7Days <= input.cap
      ? { status: "pass", detail: `${input.sendsPerCustomer7Days} in 7 days.` }
      : { status: "fail", detail: `${input.sendsPerCustomer7Days} in 7 days is over the cap of ${input.cap}. Change the cap if your policy differs.` }),
  });
  add({
    id: "eu-canada", rule: "EU and Canadian recipients", tier: "info", ...APP,
    requirement: "Version 1 checks US commercial email only.",
    blocksWhenUnanswered: false,
    ...(input.euOrCanada
      ? { status: "warn", detail: "GDPR and CASL checks are not built. Check those rules separately before sending." }
      : na("No EU or Canadian recipients.")),
  });

  const blocking = rows.filter((r) => r.status === "fail" || (r.status === "needs" && r.blocksWhenUnanswered)).map((r) => r.id);
  return { approved: blocking.length === 0, bulk, rows, blocking };
}
