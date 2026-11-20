import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIN_GROUP } from "../charts/compare";
import { loadJourneys } from "../charts/crossfilter";
import { JOURNEY_STEPS, syntheticJourneys, type JourneyRow } from "../demo/journeys";
import { createNodeEngine } from "../intake/testing/node-engine";
import type { SqlEngine } from "../intake/types";
import { redactQuote, UnredactedQuoteError, type RedactedQuote } from "../redaction/quote";
import { wilsonInterval } from "../stats/readout";
import { PAINS, syntheticComments, type Pain } from "./comments";
import { loadComments, mentionRates, type MentionRates } from "./mentions";
import { COMMENT_COLUMN, prepareComments, type CommentRow } from "./prepare";

function person(segment: JourneyRow["segment"], channel: JourneyRow["channel"], reached: number, support = false): JourneyRow {
  const main = JOURNEY_STEPS.slice(0, reached) as string[];
  const path = support && reached >= 3 ? [...main.slice(0, 3), "Support", ...main.slice(3)] : main;
  const times = path.map((_, i) => new Date(Date.UTC(2026, 6, 1, i)).toISOString());
  return { segment, channel, steps: JOURNEY_STEPS.map((s, i) => (i < reached ? s : null)), reached: main[main.length - 1], path, times };
}

function row(customer: number, j: JourneyRow, pain: Pain): CommentRow {
  return {
    customer,
    segment: j.segment,
    channel: j.channel,
    reached: j.reached,
    pain,
    severity: 1,
    quote: redactQuote({ text: `A comment about ${pain}.`, sourceColumn: COMMENT_COLUMN }),
  };
}

const find = (r: MentionRates, value: string) => r.groups.find((g) => g.value === value)!;
const pain = (g: MentionRates["overall"], p: Pain) => g.pains.find((x) => x.pain === p)!;

describe("mentionRates on counts worked out by hand", () => {
  // Customers and what they said:
  //   0 to 39: new, ads, left at Cart. 20 say shipping cost, 20 say pricing.
  //   40 to 69: returning, email, bought, used Support. 15 say slow support, 15 say no complaint.
  //   70 to 89: returning, email, bought, no Support. 10 say slow delivery, 10 say no complaint.
  //   90 to 99: vip, organic, stopped at Product. All 10 say product information. Under 30, so hidden.
  // Plus one comment from customer 500, who is not in the journeys, so it cannot be linked and is counted apart.
  const journeys: JourneyRow[] = [
    ...Array.from({ length: 40 }, () => person("new", "ads", 3)),
    ...Array.from({ length: 30 }, () => person("returning", "email", 4, true)),
    ...Array.from({ length: 20 }, () => person("returning", "email", 4)),
    ...Array.from({ length: 10 }, () => person("vip", "organic", 2)),
  ];
  const said: Pain[] = [
    ...Array<Pain>(20).fill("shipping_cost"),
    ...Array<Pain>(20).fill("pricing"),
    ...Array<Pain>(15).fill("support_slow"),
    ...Array<Pain>(15).fill("no_issue"),
    ...Array<Pain>(10).fill("slow_delivery"),
    ...Array<Pain>(10).fill("no_issue"),
    ...Array<Pain>(10).fill("product_info"),
  ];
  const rows = [...said.map((p, i) => row(i, journeys[i], p)), row(500, journeys[0], "pricing")];
  let e: SqlEngine;
  beforeAll(async () => {
    e = await createNodeEngine({ isolated: true });
    await loadJourneys(e, "journeys", journeys);
    await loadComments(e, "comments", rows);
  }, 120_000);
  afterAll(async () => e.close?.());

  it("counts 100 linked comments and 1 that matches no customer", async () => {
    const r = await mentionRates(e, { comments: "comments", journeys: "journeys" }, "reached");
    expect(r.overall.comments).toBe(100);
    expect(r.unlinked).toBe(1);
    expect(pain(r.overall, "shipping_cost").mentions).toBe(20);
    expect(pain(r.overall, "shipping_cost").rate).toBeCloseTo(0.2, 12);
  });

  it("gives half of the Cart leavers mentioning shipping cost, with the Wilson interval", async () => {
    const r = await mentionRates(e, { comments: "comments", journeys: "journeys" }, "reached");
    const cart = pain(find(r, "Cart"), "shipping_cost");
    expect([cart.mentions, find(r, "Cart").comments]).toEqual([20, 40]);
    const w = wilsonInterval(20, 40, 0.05);
    expect(cart.low).toBeCloseTo(w.low, 12);
    expect(cart.high).toBeCloseTo(w.high, 12);
  });

  it("lists every pain in every shown group, zeros included, in the fixed order", async () => {
    const r = await mentionRates(e, { comments: "comments", journeys: "journeys" }, "reached");
    for (const g of r.groups.filter((x) => !x.tooSmall)) expect(g.pains.map((x) => x.pain)).toEqual([...PAINS]);
    expect(pain(find(r, "Purchase"), "shipping_cost").mentions).toBe(0);
  });

  it("hides the numbers of a group under the minimum, but still says it exists", async () => {
    const r = await mentionRates(e, { comments: "comments", journeys: "journeys" }, "reached");
    const product = find(r, "Product");
    expect(product.comments).toBeLessThan(MIN_GROUP);
    expect(product.tooSmall).toBe(true);
    expect(product.pains).toEqual([]);
  });

  it("splits by whether the path went through Support, taken from the journeys table", async () => {
    const r = await mentionRates(e, { comments: "comments", journeys: "journeys" }, "support");
    expect(find(r, "used Support").comments).toBe(30);
    expect(pain(find(r, "used Support"), "support_slow").mentions).toBe(15);
    expect(find(r, "no Support").comments).toBe(70);
    expect(pain(find(r, "no Support"), "support_slow").mentions).toBe(0);
  });

  it("splits by segment and channel from the journeys table", async () => {
    const seg = await mentionRates(e, { comments: "comments", journeys: "journeys" }, "segment");
    expect(seg.groups.map((g) => [g.value, g.comments])).toEqual([["new", 40], ["returning", 50], ["vip", 10]]);
    const ch = await mentionRates(e, { comments: "comments", journeys: "journeys" }, "channel");
    expect(pain(find(ch, "ads"), "pricing").mentions).toBe(20);
  });

  it("refuses a dimension that is not on the fixed list, and a bad table name", async () => {
    await expect(mentionRates(e, { comments: "comments", journeys: "journeys" }, "pain; DROP" as never)).rejects.toThrow(RangeError);
    await expect(mentionRates(e, { comments: "comments x", journeys: "journeys" }, "reached")).rejects.toThrow(RangeError);
  });
});

describe("loadComments only takes text that passed redaction", () => {
  it("refuses a row whose quote was not issued by the redaction step, and stores nothing", async () => {
    const e = await createNodeEngine({ isolated: true });
    const j = person("new", "ads", 3);
    const good = row(0, j, "pricing");
    const forged = { ...good, customer: 1, quote: { ...good.quote } as RedactedQuote };
    await expect(loadComments(e, "comments", [good, forged])).rejects.toThrow(UnredactedQuoteError);
    const tables = await e.query("SELECT count(*) AS n FROM information_schema.tables WHERE table_name = 'comments'", []);
    expect(Number(Object.values(tables[0] as object)[0])).toBe(0);
    await e.close?.();
  });
});

describe("mentionRates on the synthetic comments, against an independent count", () => {
  const journeys = syntheticJourneys(20_000, 11);
  const raw = syntheticComments(journeys, 3_000, 17);
  const prepared = prepareComments(raw);
  let e: SqlEngine;
  beforeAll(async () => {
    e = await createNodeEngine({ isolated: true });
    await loadJourneys(e, "journeys", journeys);
    await loadComments(e, "comments", prepared.rows);
  }, 120_000);
  afterAll(async () => e.close?.());

  it("matches a count made in plain code for every group and pain, by reached step", async () => {
    const r = await mentionRates(e, { comments: "comments", journeys: "journeys" }, "reached");
    expect(r.overall.comments).toBe(prepared.rows.length);
    expect(r.unlinked).toBe(0);
    for (const g of r.groups.filter((x) => !x.tooSmall)) {
      const inGroup = prepared.rows.filter((c) => c.reached === g.value);
      expect(g.comments).toBe(inGroup.length);
      for (const p of g.pains) expect(p.mentions).toBe(inGroup.filter((c) => c.pain === p.pain).length);
    }
  });

  it("finds the planted facts: Cart leavers and shipping cost, Support users and slow support", async () => {
    const reached = await mentionRates(e, { comments: "comments", journeys: "journeys" }, "reached");
    const cart = pain(find(reached, "Cart"), "shipping_cost");
    expect(cart.low).toBeGreaterThan(pain(reached.overall, "shipping_cost").high);
    const support = await mentionRates(e, { comments: "comments", journeys: "journeys" }, "support");
    expect(pain(find(support, "used Support"), "support_slow").low).toBeGreaterThan(pain(find(support, "no Support"), "support_slow").high);
  });
});
