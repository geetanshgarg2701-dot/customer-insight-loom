import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadJourneys } from "../charts/crossfilter";
import { JOURNEY_STEPS, syntheticJourneys, type JourneyRow } from "../demo/journeys";
import { createNodeEngine } from "../intake/testing/node-engine";
import type { SqlEngine } from "../intake/types";
import { redactQuote } from "../redaction/quote";
import { benjaminiHochberg } from "../stats/bh";
import { newcombeDifference, twoProportionPValue } from "../stats/readout";
import { syntheticComments, type Pain } from "./comments";
import { loadComments } from "./mentions";
import { COMMENT_COLUMN, prepareComments, type CommentRow } from "./prepare";
import { QUOTES_PER_ITEM, whyAtStep } from "./why";

function person(segment: JourneyRow["segment"], channel: JourneyRow["channel"], reached: number): JourneyRow {
  const path = JOURNEY_STEPS.slice(0, reached) as string[];
  const times = path.map((_, i) => new Date(Date.UTC(2026, 6, 1, i)).toISOString());
  return { segment, channel, steps: JOURNEY_STEPS.map((s, i) => (i < reached ? s : null)), reached: path[path.length - 1], path, times };
}

function row(customer: number, j: JourneyRow, pain: Pain, text = `About ${pain}.`): CommentRow {
  return {
    customer,
    segment: j.segment,
    channel: j.channel,
    reached: j.reached,
    pain,
    severity: 1,
    quote: redactQuote({ text, sourceColumn: COMMENT_COLUMN }),
  };
}

const T = { comments: "why_comments", journeys: "why_journeys" };

describe("whyAtStep on counts worked out by hand", () => {
  // Customers 0 to 59: returning, email, bought. Comments: 0 to 5 shipping cost, 6 and 7 pricing, 8 to 59 no complaint.
  // Customers 60 to 119: new, ads, left at Cart. Comments: 60 to 89 shipping cost, 90 to 97 pricing, 98 to 119 no complaint.
  // Customers 120 to 159: vip, organic, bought. No comments.
  // Customers 160 to 169: vip, email, left at Cart. No comments. A group of 10, too small to compare.
  //
  // At Cart: 170 reached it, 70 left and 100 went on.
  //   Themes, among the 120 commenters: 60 left, 30 shipping cost and 8 pricing. 60 went on, 6 shipping cost and 2 pricing.
  //   Segments, among all 170: new, ads left 60 of 60, against 10 of the other 110. returning, email left 0 of 60.
  //   vip, organic left 0 of 40. vip, email is under 30 and is not compared.
  //   6 themes and 3 segment groups: 9 comparisons. Pricing has a raw p value just under 0.05, which does not survive.
  // The customers who went on have the lowest numbers, so a quote query that forgot to keep only those who left would
  // pick them first.
  const journeys = [
    ...Array.from({ length: 60 }, () => person("returning", "email", 4)),
    ...Array.from({ length: 60 }, () => person("new", "ads", 3)),
    ...Array.from({ length: 40 }, () => person("vip", "organic", 4)),
    ...Array.from({ length: 10 }, () => person("vip", "email", 3)),
  ];
  const said: Pain[] = [
    ...Array<Pain>(6).fill("shipping_cost"), ...Array<Pain>(2).fill("pricing"), ...Array<Pain>(52).fill("no_issue"),
    ...Array<Pain>(30).fill("shipping_cost"), ...Array<Pain>(8).fill("pricing"), ...Array<Pain>(22).fill("no_issue"),
  ];
  const rows = said.map((p, i) =>
    i === 60 ? row(i, journeys[i], p, "Shipping too high, write to me@example.invalid.") : row(i, journeys[i], p),
  );
  let e: SqlEngine;
  beforeAll(async () => {
    e = await createNodeEngine({ isolated: true });
    await loadJourneys(e, T.journeys, journeys);
    await loadComments(e, T.comments, rows);
  });
  afterAll(async () => e.close?.());

  it("counts who reached the step, who left, and the commenters on each side, leaving out a group under 30", async () => {
    const w = await whyAtStep(e, T, 2, {});
    expect([w.step, w.next, w.reached, w.left]).toEqual(["Cart", "Purchase", 170, 70]);
    expect(w.commenters).toEqual({ left: 60, wentOn: 60 });
    expect(w.comparisons).toBe(9);
    expect(w.tested.some((t) => t.key === "vip|email")).toBe(false);
  });

  it("ranks only the flagged items that go with more leaving, largest gap first, segments and themes together", async () => {
    const w = await whyAtStep(e, T, 2, {});
    expect(w.items.map((i) => `${i.kind}: ${i.label}`)).toEqual(["segment: new, ads", "theme: Shipping costs too much"]);
    const theme = w.items[1];
    expect([theme.a, theme.b]).toEqual([{ x: 30, n: 60 }, { x: 6, n: 60 }]);
    expect(theme.difference).toBeCloseTo(0.4, 12);
    const ci = newcombeDifference(30, 60, 6, 60, 0.05);
    expect([theme.low, theme.high]).toEqual([ci.low, ci.high]);
    const seg = w.items[0];
    expect([seg.a, seg.b]).toEqual([{ x: 60, n: 60 }, { x: 10, n: 110 }]);
  });

  it("adjusts all 9 p values together with Benjamini Hochberg, so pricing at p about 0.048 is not flagged", async () => {
    const w = await whyAtStep(e, T, 2, {});
    const bh = benjaminiHochberg(w.tested.map((t) => t.p), 0.05);
    w.tested.forEach((t, i) => {
      expect(t.adjusted).toBeCloseTo(bh.adjusted[i], 14);
      expect(t.flagged).toBe(bh.rejected[i]);
    });
    const ship = w.tested.find((t) => t.key === "shipping_cost")!;
    expect(ship.p).toBeCloseTo(twoProportionPValue(30, 60, 6, 60), 14);
    const pricing = w.tested.find((t) => t.key === "pricing")!;
    expect(pricing.p).toBeCloseTo(twoProportionPValue(8, 60, 2, 60), 14);
    expect(pricing.p).toBeLessThan(0.05);
    expect(pricing.flagged).toBe(false);
  });

  it("supports a theme with redacted quotes from customers who left at the step only, in customer order", async () => {
    const w = await whyAtStep(e, T, 2, {});
    const quotes = w.items[1].quotes;
    expect(QUOTES_PER_ITEM).toBe(3);
    expect(quotes.map((q) => q.customer)).toEqual([60, 61, 62]);
    expect(quotes[0].text).toBe("Shipping too high, write to [EMAIL].");
    expect(w.items[0].quotes).toEqual([]);
  });

  it("follows the page filters, and compares nothing when a side has fewer than 30", async () => {
    const w = await whyAtStep(e, T, 2, { channel: ["ads"] });
    expect([w.reached, w.left]).toEqual([60, 60]);
    expect(w.commenters).toEqual({ left: 60, wentOn: 0 });
    expect(w.comparisons).toBe(0);
    expect(w.items).toEqual([]);
  });

  it("has nothing to compare at the last step, and refuses a step that does not exist", async () => {
    const w = await whyAtStep(e, T, 3, {});
    expect(w.next).toBeNull();
    expect(w.comparisons).toBe(0);
    await expect(whyAtStep(e, T, 4, {})).rejects.toThrow(RangeError);
    await expect(whyAtStep(e, { ...T, comments: "bad name" }, 2, {})).rejects.toThrow(RangeError);
  });
});

describe("whyAtStep on the synthetic data the two screens share", () => {
  const journeys = syntheticJourneys(100_000, 11);
  const commentJourneys = syntheticJourneys(20_000, 11);
  const prepared = prepareComments(syntheticComments(commentJourneys, 3_000, 17));
  let e: SqlEngine;
  beforeAll(async () => {
    e = await createNodeEngine({ isolated: true });
    await loadJourneys(e, T.journeys, journeys);
    await loadComments(e, T.comments, prepared.rows);
  }, 180_000);
  afterAll(async () => e.close?.());

  it("makes the first 20,000 of the 100,000 journeys the same customers the comments were made from", () => {
    expect(journeys.slice(0, 20_000)).toEqual(commentJourneys);
  });

  it("matches an independent count of the commenters who left at the Cart, and flags shipping cost there", async () => {
    const w = await whyAtStep(e, T, 2, {});
    const atCart = prepared.rows.filter((r) => journeys[r.customer].steps[2] !== null);
    expect(w.commenters.left).toBe(atCart.filter((r) => journeys[r.customer].steps[3] === null).length);
    expect(w.commenters.wentOn).toBe(atCart.filter((r) => journeys[r.customer].steps[3] !== null).length);
    expect(w.items.some((i) => i.kind === "theme" && i.key === "shipping_cost")).toBe(true);
  });
});
