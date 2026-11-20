/**
 * Email drafts per segment with a named framework, plan M15. Built from a template and what the person typed, and
 * labeled as exactly that. No language model writes it: the model the app can run in a browser only turns text into
 * vectors, and a draft needs words. So the label the plan asked for, AI generated, would be false, and this one says what
 * is true.
 *
 * What a draft will not do: invent a number, claim a result, or speak for other customers, since the app cannot know
 * them. Every digit in a draft comes from the offer, the brand or the call to action the person typed. A draft carries an
 * advertisement label, an opt out line and a placeholder where the postal address goes, so it cannot pass the email check
 * until a person puts a real address in. A person must approve it, and nothing is sent.
 */
import type { Pain } from "../insights/comments";
import { PAIN_LABELS } from "../insights/comments";
import type { FrameworkTag } from "../ledger/ledger";

export const DRAFT_LABEL = "Built by the app from a template and your inputs. No language model wrote it. A person must approve it.";
export const ADDRESS_PLACEHOLDER = "[Your postal address]";
export const MAX_BRAND = 80;
export const MAX_OFFER = 200;
export const MAX_CTA = 60;

export type Segment = "new" | "returning" | "vip";
export type DraftInput = {
  framework: FrameworkTag;
  pain: Exclude<Pain, "no_issue">;
  segment: Segment | null;
  brand: string;
  offer: string;
  callToAction: string;
};
export type DraftPart = { label: string; text: string };
export type Draft = { framework: FrameworkTag; subject: string; body: string; parts: DraftPart[]; label: string };

type Theme = { topic: string; problem: string; agitate: string; advantage: string; benefit: string; attention: string };
const THEMES: Readonly<Record<Exclude<Pain, "no_issue">, Theme>> = {
  shipping_cost: {
    topic: "shipping",
    problem: "Shipping fees can make a good order feel more expensive than it should.",
    agitate: "A total that jumps at the last step is a reason to stop and think again.",
    advantage: "The price you see is closer to the price you pay.",
    benefit: "No surprise at the last step.",
    attention: "Shipping should not be the part you dread.",
  },
  pricing: {
    topic: "prices",
    problem: "Prices can feel high when you are not sure an order is worth it.",
    agitate: "Doubt about the price is a common reason to leave a cart for later.",
    advantage: "You get more value for the same order.",
    benefit: "An easier decision about what to buy.",
    attention: "Worth it should be easy to see.",
  },
  slow_delivery: {
    topic: "delivery",
    problem: "Waiting for an order that is late is frustrating.",
    agitate: "When a parcel takes longer than expected, it is hard to plan around it.",
    advantage: "Your order reaches you sooner and you can plan around it.",
    benefit: "Less waiting and less checking the tracking page.",
    attention: "Your order, when you need it.",
  },
  support_slow: {
    topic: "support",
    problem: "Waiting days for an answer from support is not what anyone wants.",
    agitate: "A simple question left open can spoil an otherwise good order.",
    advantage: "Help is quicker to reach.",
    benefit: "Answers when you need them.",
    attention: "Questions deserve quick answers.",
  },
  site_bugs: {
    topic: "checkout",
    problem: "A site that freezes or an app that errors at the wrong moment gets in the way of an order.",
    agitate: "Starting over because a page failed is a good reason to give up.",
    advantage: "Checkout works the first time.",
    benefit: "An order that goes through without a fight.",
    attention: "Checkout should just work.",
  },
  product_info: {
    topic: "product details",
    problem: "It is hard to order when the page does not say what you need to know.",
    agitate: "Guessing at a size or a material is a poor way to buy.",
    advantage: "The details you need are easy to find.",
    benefit: "Confidence that it is the right one before you order.",
    attention: "The details you need, where you can find them.",
  },
};

const SEGMENT_LINE: Readonly<Record<Segment, string>> = {
  new: "If you are new here, welcome.",
  returning: "Thanks for coming back.",
  vip: "As a valued customer, you hear this first.",
};

function clean(label: string, value: string, max: number): string {
  const v = value.trim();
  if (v.length === 0 || v.length > max) throw new RangeError(`${label} must be 1 to ${max} characters.`);
  return v;
}

export function buildDraft(input: DraftInput): Draft {
  const theme = THEMES[input.pain];
  if (!theme) throw new RangeError("A draft needs a complaint to speak to.");
  const brand = clean("The brand", input.brand, MAX_BRAND);
  const offer = clean("The offer", input.offer, MAX_OFFER);
  const cta = clean("The call to action", input.callToAction, MAX_CTA);
  const offerLine = `${brand} now offers ${offer}.`;
  const action = `${cta}.`;

  let parts: DraftPart[];
  let subject: string;
  switch (input.framework) {
    case "PAS":
      parts = [
        { label: "Problem", text: theme.problem },
        { label: "Agitate", text: theme.agitate },
        { label: "Solution", text: offerLine },
        { label: "Action", text: action },
      ];
      subject = `A simpler answer on ${theme.topic}`;
      break;
    case "FAB":
      parts = [
        { label: "Feature", text: offerLine },
        { label: "Advantage", text: theme.advantage },
        { label: "Benefit", text: theme.benefit },
        { label: "Action", text: action },
      ];
      subject = `New at ${brand}: easier ${theme.topic}`;
      break;
    case "AIDA":
      parts = [
        { label: "Attention", text: theme.attention },
        { label: "Interest", text: theme.problem },
        { label: "Desire", text: `${offerLine} ${theme.benefit}` },
        { label: "Action", text: action },
      ];
      subject = `Your ${theme.topic}, sorted by ${brand}`;
      break;
    default:
      throw new RangeError("That is not a framework the app names.");
  }

  const body = [
    `Advertisement from ${brand}.`,
    ...(input.segment ? [SEGMENT_LINE[input.segment]] : []),
    ...parts.map((p) => p.text),
    ADDRESS_PLACEHOLDER,
    "Unsubscribe or manage your email preferences at any time.",
  ].join("\n\n");

  return { framework: input.framework, subject, body, parts, label: DRAFT_LABEL };
}

/** The test this email would be, in one sentence for the ledger. It promises no result. */
export function draftHypothesis(input: DraftInput): string {
  const who = input.segment ? `${input.segment} customers` : "customers";
  return `A ${input.framework} email about ${input.offer.trim()}, sent to ${who} who raised ${PAIN_LABELS[input.pain]}, changes conversion against a holdout.`;
}
