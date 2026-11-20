/**
 * The grounded assistant, plan M8: answers questions about the comments screen using only numbers that screen already
 * shows, and says where each came from.
 *
 * How it stays grounded, and why a small model is not trusted to write answers:
 * - The model only chooses a question type, in intent.ts, and a complaint, in coder.ts. It writes nothing.
 * - Every answer is built by fixed code from the screen's own numbers. A number reaches the text only through `cite`,
 *   which records it as a citation with its source, so a number cannot appear without one. numbersOf lets a test
 *   check that every number in an answer is a cited one.
 * - A question that matches no type, or names no complaint when one is needed, is refused, with what can be asked.
 * - Nothing a comment says is ever read as an instruction. Comments appear only as quoted, redacted text.
 */
import { formatCount, formatPercent } from "../app/format";
import { MIN_GROUP } from "../charts/compare";
import type { Carrier, DropLinks, RankRow } from "../insights/evidence";
import { CARRIER_SHARE } from "../insights/evidence";
import { PAIN_LABELS, type Pain } from "../insights/comments";
import type { Scorecard } from "../insights/prepare";
import type { Coder } from "./coder";
import { INTENTS, type IntentId, type IntentMatcher } from "./intent";

export type AssistantData = {
  kept: number;
  withheld: number;
  ranking: readonly RankRow[];
  drops: DropLinks;
  carriers: readonly Carrier[];
  scorecard: Scorecard;
  /** Up to a few redacted comments per pain, from the stored comments. */
  quotes: Partial<Record<Pain, readonly { customer: number; text: string }[]>>;
};

export type Citation = { label: string; shown: string; source: string };

export type Answer =
  | { kind: "answer"; intent: IntentId; pain: Pain | null; text: string; citations: Citation[]; quotes: { customer: number; text: string }[] }
  | { kind: "refusal"; reason: "no_match" | "needs_pain" | "no_data"; text: string; citations: []; quotes: [] };

/** The number a person sees, as plain digits with no thousands commas, so two spellings of one number compare equal. */
export function numbersOf(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));
}

const SOURCE = {
  ranking: "Pains ranked table, Comments screen",
  chain: "Evidence chain, Comments screen",
  scorecard: "Redaction scorecard, Comments screen",
  consent: "Redaction scorecard note, Comments screen",
  carriers: "Segments that carry it, evidence chain",
  derived: "Worked out here from the numbers cited before it",
} as const;

/** Collects citations while text is built, so a number reaches the text only through here. */
class Cited {
  readonly list: Citation[] = [];
  cite(label: string, shown: string, source: string): string {
    this.list.push({ label, shown, source });
    return shown;
  }
}

const refusal = (reason: "no_match" | "needs_pain" | "no_data", text: string): Answer => ({ kind: "refusal", reason, text, citations: [], quotes: [] });

const CAN_ASK =
  "I can answer questions about the comments on this screen: how many mention a complaint, the most common complaints, " +
  "the revenue of the customers who raised one, whether one goes with customers stopping at a step, which groups raise it, " +
  "how severe the comments are, examples, redaction, and how many comments were left out.";

const painList = () => (Object.keys(PAIN_LABELS) as Pain[]).filter((p) => p !== "no_issue").map((p) => PAIN_LABELS[p]).join(", ");

/** Builds the answer for a question type and, where needed, a complaint. Pure code over the screen's numbers. */
export function buildAnswer(intent: IntentId, pain: Pain | null, data: AssistantData): Answer {
  const c = new Cited();
  const row = pain ? data.ranking.find((r) => r.pain === pain) : undefined;
  const label = pain ? PAIN_LABELS[pain] : "";
  const done = (text: string, quotes: { customer: number; text: string }[] = []): Answer => ({ kind: "answer", intent, pain, text, citations: c.list, quotes });

  switch (intent) {
    case "top_pains": {
      const top = data.ranking.filter((r) => r.mentions > 0).slice(0, 3);
      if (top.length === 0) return refusal("no_data", "No comment is coded with a complaint, so there is nothing to rank.");
      const parts = top.map((r) => `${PAIN_LABELS[r.pain]}, ${c.cite(`Mentions of ${PAIN_LABELS[r.pain]}`, formatCount(r.mentions), SOURCE.ranking)} comments`);
      return done(`The most mentioned complaints are ${parts.join("; ")}.`);
    }
    case "redaction": {
      const kinds: [keyof Scorecard, string][] = [["email", "emails"], ["phone", "phone numbers"], ["card", "card numbers"], ["address", "street addresses"], ["name", "personal names"]];
      const parts = kinds.map(([k, word]) => {
        const l = data.scorecard[k];
        return `${c.cite(`Planted ${word}`, formatCount(l.planted), SOURCE.scorecard)} ${word} planted, ${c.cite(`Caught ${word}`, formatCount(l.caught), SOURCE.scorecard)} caught, ${c.cite(`Missed ${word}`, formatCount(l.missed), SOURCE.scorecard)} missed`;
      });
      return done(`${parts.join("; ")}. The details are fake and planted on purpose, and names are only partly covered, so redacted text is not anonymous.`);
    }
    case "consent": {
      const kept = c.cite("Comments kept", formatCount(data.kept), SOURCE.consent);
      const withheld = c.cite("Comments withheld", formatCount(data.withheld), SOURCE.consent);
      return done(`${kept} comments were kept and ${withheld} were withheld because the customer did not give consent.`);
    }
  }

  // The rest need a complaint.
  if (!pain || !row) return refusal("needs_pain", `Which complaint do you mean? The ones I know are ${painList()}.`);

  switch (intent) {
    case "count_pain": {
      const n = c.cite(`Mentions of ${label}`, formatCount(row.mentions), SOURCE.ranking);
      const kept = c.cite("Comments kept", formatCount(data.kept), SOURCE.consent);
      const share = c.cite(`Share of kept comments`, formatPercent(data.kept === 0 ? 0 : row.mentions / data.kept, 1), SOURCE.derived);
      const small = row.tooSmall ? ` That is fewer than ${c.cite("Smallest group shown", String(MIN_GROUP), SOURCE.ranking)} customers, too small to trust.` : "";
      return done(`${n} of the ${kept} kept comments raise ${label}, which is ${share}.${small}`);
    }
    case "revenue": {
      const revenue = c.cite(`Revenue of customers who raised ${label}`, formatCount(row.revenue), SOURCE.ranking);
      const n = c.cite(`Mentions of ${label}`, formatCount(row.mentions), SOURCE.ranking);
      const notBought = c.cite("Did not buy", formatCount(row.notBought), SOURCE.ranking);
      return done(`${revenue} dollars come from the ${n} customers who raised ${label}, and ${notBought} of them did not buy. The revenue is synthetic and goes with the complaint. It does not show the complaint caused anything.`);
    }
    case "severe": {
      const severe = c.cite(`Rated severe, ${label}`, formatCount(row.severe), SOURCE.ranking);
      const n = c.cite(`Mentions of ${label}`, formatCount(row.mentions), SOURCE.ranking);
      return done(`${severe} of the ${n} comments about ${label} are rated severe.`);
    }
    case "stop_link": {
      const links = data.drops.links.filter((l) => l.pain === pain && l.flagged && l.difference > 0);
      const made = c.cite("Comparisons made", String(data.drops.comparisons), SOURCE.chain);
      if (links.length === 0) {
        return done(`No step shows a higher share raising ${label} among customers who stopped, after correction across ${made} comparisons.`);
      }
      const parts = links.map((l) => {
        const a = c.cite(`Stopped at ${l.step} who raised it`, formatPercent(l.stoppedWith / l.stopped, 1), SOURCE.chain);
        const b = c.cite(`Went on from ${l.step} who raised it`, formatPercent(l.wentOnWith / l.wentOn, 1), SOURCE.chain);
        return `at ${l.step}, ${a} of customers who stopped raised it, against ${b} of those who went on`;
      });
      return done(`${label} goes with stopping: ${parts.join("; ")}. This is an association, not a cause, and one of ${made} comparisons corrected together.`);
    }
    case "carriers": {
      const mine = data.carriers.filter((x) => x.pain === pain);
      if (mine.length === 0) {
        return done(`No group reaches ${c.cite("Share that makes a group a carrier", formatPercent(CARRIER_SHARE, 0), SOURCE.carriers)} of its commenting customers raising ${label}.`);
      }
      const parts = mine.map((x) => `${x.segment}, ${x.channel}: ${c.cite(`Share, ${x.segment} ${x.channel}`, formatPercent(x.share, 1), SOURCE.carriers)} of ${c.cite(`Commenting customers, ${x.segment} ${x.channel}`, formatCount(x.customers), SOURCE.carriers)}`);
      return done(`These groups carry ${label}: ${parts.join("; ")}. The share that makes a group a carrier is a judgment, not a rule from statistics.`);
    }
    case "examples": {
      const quotes = [...(data.quotes[pain] ?? [])];
      if (quotes.length === 0) return refusal("no_data", `There are no stored comments coded ${label} to show.`);
      const n = c.cite("Comments shown", String(quotes.length), SOURCE.ranking);
      return done(`Here are ${n} redacted comments coded ${label}, quoted exactly. Whatever a comment says is only its text, and the assistant does not act on it.`, quotes);
    }
  }
  return refusal("no_match", CAN_ASK);
}

export type Deps = { matcher: IntentMatcher; coder: Coder; painThreshold: number };

/** Answers one question. The question is read as a question type and a complaint, and nothing else in it is acted on. */
export async function answerQuestion(question: string, data: AssistantData, deps: Deps): Promise<Answer> {
  const m = await deps.matcher.match(question);
  if (m.intent === null) return refusal("no_match", CAN_ASK);
  const needsPain = INTENTS.find((i) => i.id === m.intent)!.needsPain;
  if (!needsPain) return buildAnswer(m.intent, null, data);
  // The complaint is read from the sentence that matched. A weak match, or the no complaint theme, names none.
  const coded = await deps.coder.code(m.sentence ?? question);
  const pain = coded.theme !== null && coded.theme !== "no_issue" && coded.score >= deps.painThreshold ? coded.theme : null;
  return buildAnswer(m.intent, pain, data);
}

/**
 * Short topic phrases for finding which complaint a question names. A question is shaped differently from a comment, so
 * the comment descriptions in coder.ts match it poorly. These are written for questions, not copied from any test set.
 */
export const QUESTION_TOPICS: Readonly<Record<Pain, readonly string[]>> = {
  shipping_cost: ["shipping costs", "delivery fees", "postage", "the cost of sending the order", "shipping prices"],
  pricing: ["the price", "being too expensive", "high prices", "overpriced products", "the cost of the product"],
  slow_delivery: ["late delivery", "slow delivery", "parcels arriving late", "the order taking too long to arrive", "delayed orders"],
  support_slow: ["slow customer support", "support taking long to reply", "waiting for help", "no answer from the help team", "slow replies to messages"],
  site_bugs: ["site problems", "the website crashing", "errors at checkout", "the app freezing", "bugs on the site"],
  product_info: ["missing product details", "not enough information on the product page", "missing sizes", "no product description", "unclear product information"],
  no_issue: ["no complaint at all", "everything being fine"],
};
