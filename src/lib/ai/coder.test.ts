import { describe, expect, it } from "vitest";
import { assertExactQuote, createCoder, splitSentences, THEME_DESCRIPTIONS, THEME_ORDER, type Embed } from "./coder";

describe("splitSentences", () => {
  it("returns exact, trimmed slices of the text, one per sentence", () => {
    const text = "  The box was crushed.  Shipping cost a lot!\nWould I buy again? Maybe";
    const s = splitSentences(text);
    expect(s.map((x) => x.text)).toEqual(["The box was crushed.", "Shipping cost a lot!", "Would I buy again?", "Maybe"]);
    for (const q of s) expect(text.slice(q.start, q.end)).toBe(q.text);
  });

  it("skips pieces with no letter or number, and handles an empty text", () => {
    expect(splitSentences("... !!! ?")).toEqual([]);
    expect(splitSentences("")).toEqual([]);
  });
});

describe("assertExactQuote", () => {
  const comment = "It arrived late. Otherwise fine.";
  it("accepts the comment's own words at their place", () => {
    expect(() => assertExactQuote(comment, { start: 0, end: 16, text: "It arrived late." })).not.toThrow();
  });
  it("refuses changed words, a shifted place, and a span outside the text", () => {
    expect(() => assertExactQuote(comment, { start: 0, end: 16, text: "It arrived very late." })).toThrow();
    expect(() => assertExactQuote(comment, { start: 1, end: 17, text: "It arrived late." })).toThrow();
    expect(() => assertExactQuote(comment, { start: 20, end: 99, text: "fine." })).toThrow();
  });
});

/**
 * A fake embedding with known answers: each theme gets its own axis, and a sentence lands on the axis of the first theme
 * whose keyword it contains, with a set strength. Anything else lands on a spare axis that matches no theme.
 */
const KEYWORDS: Record<string, string> = { ship: "shipping_cost", price: "pricing", late: "slow_delivery", reply: "support_slow", crash: "site_bugs", size: "product_info", great: "no_issue" };
const fake: Embed = async (texts) =>
  texts.map((t) => {
    const v = new Float32Array(THEME_ORDER.length + 1);
    const desc = THEME_ORDER.findIndex((th) => THEME_DESCRIPTIONS[th].includes(t));
    if (desc >= 0) {
      v[desc] = 1;
      return v;
    }
    const lower = t.toLowerCase();
    const hit = Object.entries(KEYWORDS).find(([k]) => lower.includes(k));
    const strength = lower.includes("weak") ? 0.3 : 0.9;
    if (hit) {
      v[THEME_ORDER.indexOf(hit[1] as (typeof THEME_ORDER)[number])] = strength;
      v[THEME_ORDER.length] = Math.sqrt(1 - strength * strength);
    } else v[THEME_ORDER.length] = 1;
    return v;
  });

describe("createCoder with a known embedding", () => {
  it("picks the theme of the strongest sentence and quotes that sentence exactly", async () => {
    const coder = await createCoder(fake, 0.5);
    const text = "Lovely colors. The shipping fee was absurd. Fine otherwise.";
    const c = await coder.code(text);
    expect(c.theme).toBe("shipping_cost");
    expect(c.quote).toEqual({ start: 15, end: 43, text: "The shipping fee was absurd." });
    expect(text.slice(c.quote!.start, c.quote!.end)).toBe(c.quote!.text);
    expect(c.score).toBeCloseTo(0.9, 6);
  });

  it("says uncertain, with no quote, when the best match is below the threshold", async () => {
    const coder = await createCoder(fake, 0.5);
    const c = await coder.code("A weak hint about the price.");
    expect(c.theme).toBeNull();
    expect(c.quote).toBeNull();
    expect(c.score).toBeCloseTo(0.3, 6);
  });

  it("says uncertain for text with no sentence", async () => {
    expect((await (await createCoder(fake, 0.5)).code("...")).theme).toBeNull();
  });

  it("codes many comments in one call, each with its own quote, in order", async () => {
    const coder = await createCoder(fake, 0.5);
    const texts = ["It crashed at checkout.", "No reply from support. Also it came weak and late.", "Great!"];
    const coded = await coder.codeMany(texts);
    expect(coded.map((c) => c.theme)).toEqual(["site_bugs", "support_slow", "no_issue"]);
    coded.forEach((c, i) => expect(texts[i].slice(c.quote!.start, c.quote!.end)).toBe(c.quote!.text));
    expect(coded[1].quote!.text).toBe("No reply from support.");
  });

  it("refuses a threshold outside -1 to 1", async () => {
    await expect(createCoder(fake, 1)).rejects.toThrow(RangeError);
    await expect(createCoder(fake, -1.5)).rejects.toThrow(RangeError);
  });
});
