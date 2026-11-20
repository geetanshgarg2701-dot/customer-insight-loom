/**
 * Theme coding, plan M13: which pain a comment raises, with a supporting quote. It runs on an embedding model in the
 * browser, so comment text never leaves the device. The model only turns sentences into vectors. This file decides.
 *
 * How it decides: the comment is split into sentences. Each sentence is compared with short descriptions of each theme,
 * written for this app. The best sentence and theme win. The quote is that sentence, an exact slice of the comment, and
 * it is checked before it is used, so the coder can never show words the customer did not write. When the best match
 * is weak, the answer is uncertain rather than a guess.
 *
 * It is not a person. The evaluation in eval.ts measures how often it agrees with a person, and the screen says so.
 */
import type { Pain } from "../insights/comments";

/** Turns texts into vectors of length one. Supplied by the caller: the browser model, or a test double. */
export type Embed = (texts: string[]) => Promise<Float32Array[]>;

export const THEME_ORDER: readonly Pain[] = ["shipping_cost", "pricing", "slow_delivery", "support_slow", "site_bugs", "product_info", "no_issue"];

/** Short descriptions of each theme, written for this app. Not copied from the comment generator. */
export const THEME_DESCRIPTIONS: Readonly<Record<Pain, readonly string[]>> = {
  shipping_cost: [
    "The shipping fee is too high.",
    "Delivery charges made the order too expensive.",
    "I did not buy because of the postage cost.",
    "Free shipping only applies to large orders.",
  ],
  pricing: [
    "The product is too expensive.",
    "The price is higher than at other stores.",
    "It is overpriced for what you get.",
    "I could not afford it at this price.",
  ],
  slow_delivery: [
    "The order arrived late.",
    "The package took a long time to be delivered.",
    "Delivery was much slower than promised.",
    "I am still waiting for my parcel to arrive.",
  ],
  support_slow: [
    "Customer support took days to reply.",
    "Nobody answered my message to the help team.",
    "I waited a long time on hold for customer service.",
    "Support was slow to respond to my question.",
  ],
  site_bugs: [
    "The website crashed during checkout.",
    "A button on the site did not work.",
    "The app showed an error and froze.",
    "My cart was emptied by a glitch.",
  ],
  product_info: [
    "The product page is missing important details.",
    "I could not find the size or measurements.",
    "The description does not say what material it is.",
    "There were not enough photos of the item.",
  ],
  no_issue: [
    "Everything went well and I am happy.",
    "Great experience, no problems.",
    "I would order again.",
    "Thank you, all good.",
  ],
};

export type Quote = { start: number; end: number; text: string };
export type Coded = {
  /** The theme, or null when the best match was too weak to call. */
  theme: Pain | null;
  /** The best similarity, from -1 to 1. */
  score: number;
  /** How far the best theme is ahead of the next best, so a close call can be shown as one. */
  margin: number;
  /** The supporting sentence, an exact slice of the comment. Null when uncertain. */
  quote: Quote | null;
};

/** Sentences as exact slices of the text, trimmed of spaces, never empty. */
export function splitSentences(text: string): Quote[] {
  const out: Quote[] = [];
  const re = /[^.!?\n]+(?:[.!?]+|$)/g;
  for (const m of text.matchAll(re)) {
    let start = m.index!;
    let end = start + m[0].length;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (end > start && /[\p{L}\p{N}]/u.test(text.slice(start, end))) out.push({ start, end, text: text.slice(start, end) });
  }
  return out;
}

/** Throws unless the quote is exactly the comment's own words at that place. The check runs on every coded comment. */
export function assertExactQuote(comment: string, quote: Quote): void {
  if (quote.start < 0 || quote.end > comment.length || quote.start >= quote.end || comment.slice(quote.start, quote.end) !== quote.text) {
    throw new Error("A quote must be an exact slice of the comment, so this one was refused.");
  }
}

const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

export type Coder = { code(text: string): Promise<Coded>; codeMany(texts: readonly string[]): Promise<Coded[]> };

/**
 * A coder for one embedding model. `threshold` is the similarity below which the answer is uncertain. It is chosen on
 * the tuning set only. `descriptions` are the themes' descriptions, the comment ones unless the caller has its own.
 */
export async function createCoder(
  embed: Embed,
  threshold: number,
  descriptions: Readonly<Record<Pain, readonly string[]>> = THEME_DESCRIPTIONS,
): Promise<Coder> {
  if (!(threshold > -1 && threshold < 1)) throw new RangeError("The threshold must be between -1 and 1.");
  const themes = THEME_ORDER.flatMap((t) => descriptions[t].map((d) => ({ t, d })));
  const protoVectors = await embed(themes.map((x) => x.d));

  function decide(text: string, sentences: Quote[], vectors: Float32Array[]): Coded {
    if (sentences.length === 0) return { theme: null, score: -1, margin: 0, quote: null };
    // For each theme, its best match over every sentence and every description.
    const best = new Map<Pain, { score: number; sentence: number }>();
    vectors.forEach((v, si) => {
      themes.forEach((p, pi) => {
        const s = dot(v, protoVectors[pi]);
        const cur = best.get(p.t);
        if (!cur || s > cur.score) best.set(p.t, { score: s, sentence: si });
      });
    });
    const ranked = [...best.entries()].sort((a, b) => b[1].score - a[1].score);
    const [theme, top] = ranked[0];
    const margin = top.score - (ranked[1]?.[1].score ?? -1);
    if (top.score < threshold) return { theme: null, score: top.score, margin, quote: null };
    const quote = sentences[top.sentence];
    assertExactQuote(text, quote);
    return { theme, score: top.score, margin, quote };
  }

  async function codeMany(texts: readonly string[]): Promise<Coded[]> {
    const split = texts.map(splitSentences);
    const flat = split.flat().map((q) => q.text);
    const vectors = flat.length > 0 ? await embed(flat) : [];
    let k = 0;
    return split.map((sentences, i) => {
      const own = vectors.slice(k, k + sentences.length);
      k += sentences.length;
      return decide(texts[i], sentences, own);
    });
  }

  return { code: async (text) => (await codeMany([text]))[0], codeMany };
}
