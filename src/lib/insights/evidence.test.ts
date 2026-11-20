import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadJourneys } from "../charts/crossfilter";
import { JOURNEY_STEPS, syntheticJourneys, type JourneyRow } from "../demo/journeys";
import { createNodeEngine } from "../intake/testing/node-engine";
import type { SqlEngine } from "../intake/types";
import { redactQuote } from "../redaction/quote";
import { benjaminiHochberg } from "../stats/bh";
import { newcombeDifference, twoProportionPValue } from "../stats/readout";
import { syntheticComments, type Pain } from "./comments";
import {
  assembleChain,
  CARRIER_SHARE,
  customerRevenue,
  dropOffLinks,
  loadRevenue,
  painRanking,
  segmentCarriers,
  THEME_IDS,
  themeOf,
  type EvidenceTables,
} from "./evidence";
import { loadComments } from "./mentions";
import { COMMENT_COLUMN, prepareComments, type CommentRow } from "./prepare";

function person(segment: JourneyRow["segment"], channel: JourneyRow["channel"], reached: number): JourneyRow {
  const path = JOURNEY_STEPS.slice(0, reached) as string[];
  const times = path.map((_, i) => new Date(Date.UTC(2026, 6, 1, i)).toISOString());
  return { segment, channel, steps: JOURNEY_STEPS.map((s, i) => (i < reached ? s : null)), reached: path[path.length - 1], path, times };
}

function row(customer: number, j: JourneyRow, pain: Pain, severity: 1 | 2 | 3 = 1): CommentRow {
  return {
    customer,
    segment: j.segment,
    channel: j.channel,
    reached: j.reached,
    pain,
    severity,
    quote: redactQuote({ text: `About ${pain}.`, sourceColumn: COMMENT_COLUMN }),
  };
}

const T: EvidenceTables = { comments: "comments", journeys: "journeys", revenue: "revenue" };

describe("the evidence chain on counts worked out by hand", () => {
  // Customers 0 to 59: new, ads, left at Cart. 30 shipping cost, severity 3, and 30 pricing.
  // Customers 60 to 119: returning, email, bought for 100 dollars each. 6 shipping cost, 54 no complaint.
  // Customers 120 to 159: vip, organic, stopped at Product. 10 product information, 30 site problems.
  // Customers 160 to 164: returning, organic, stopped at Visit. All 5 say pricing. Too few to compare at Visit, and too
  // few to name as a segment, though every one of them raised pricing.
  //
  // Product to Cart: 160 reached Product, 40 stopped there, 120 went on.
  // Cart to Purchase: 120 reached Cart, 60 stopped there, 60 bought.
  // Visit to Product: nobody stopped, so that step has no comparison.
  const journeys = [
    ...Array.from({ length: 60 }, () => person("new", "ads", 3)),
    ...Array.from({ length: 60 }, () => person("returning", "email", 4)),
    ...Array.from({ length: 40 }, () => person("vip", "organic", 2)),
    ...Array.from({ length: 5 }, () => person("returning", "organic", 1)),
  ];
  const said: [Pain, 1 | 2 | 3][] = [
    ...Array.from({ length: 30 }, (): [Pain, 3] => ["shipping_cost", 3]),
    ...Array.from({ length: 30 }, (): [Pain, 1] => ["pricing", 1]),
    ...Array.from({ length: 6 }, (): [Pain, 1] => ["shipping_cost", 1]),
    ...Array.from({ length: 54 }, (): [Pain, 1] => ["no_issue", 1]),
    ...Array.from({ length: 10 }, (): [Pain, 1] => ["product_info", 1]),
    ...Array.from({ length: 30 }, (): [Pain, 1] => ["site_bugs", 1]),
    ...Array.from({ length: 5 }, (): [Pain, 1] => ["pricing", 1]),
  ];
  const revenue = journeys.map((j) => (j.reached === "Purchase" ? 100 : 0));
  let e: SqlEngine;
  beforeAll(async () => {
    e = await createNodeEngine({ isolated: true });
    await loadJourneys(e, T.journeys, journeys);
    await loadComments(e, T.comments, said.map(([p, s], i) => row(i, journeys[i], p, s)));
    await loadRevenue(e, T.revenue, revenue);
  }, 120_000);
  afterAll(async () => e.close?.());

  it("ranks pains by mentions, leaves out no complaint, and sums the revenue of the customers who raised each", async () => {
    const r = await painRanking(e, T);
    expect(r.map((x) => [x.pain, x.mentions])).toEqual([
      ["shipping_cost", 36],
      ["pricing", 35],
      ["site_bugs", 30],
      ["product_info", 10],
      ["slow_delivery", 0],
      ["support_slow", 0],
    ]);
    const ship = r[0];
    expect(ship.revenue).toBe(600);
    expect(ship.notBought).toBe(30);
    expect(ship.severe).toBe(30);
    expect(ship.tooSmall).toBe(false);
    expect(r.find((x) => x.pain === "product_info")!.tooSmall).toBe(true);
  });

  it("compares the share with each pain among those who stopped and those who went on, at each step with enough people", async () => {
    const d = await dropOffLinks(e, T);
    // 6 pains times 2 steps. Only 5 stopped at Visit, under 30, so Visit is not compared.
    expect(d.comparisons).toBe(12);
    const atCart = d.links.find((l) => l.pain === "shipping_cost" && l.step === "Cart")!;
    expect([atCart.stopped, atCart.stoppedWith, atCart.wentOn, atCart.wentOnWith]).toEqual([60, 30, 60, 6]);
    expect(atCart.difference).toBeCloseTo(0.4, 12);
    const ci = newcombeDifference(30, 60, 6, 60, 0.05);
    expect(atCart.low).toBeCloseTo(ci.low, 12);
    expect(atCart.high).toBeCloseTo(ci.high, 12);
    expect(atCart.p).toBeCloseTo(twoProportionPValue(30, 60, 6, 60), 14);
  });

  it("adjusts every p value with Benjamini Hochberg across all the comparisons shown, and flags only those that pass", async () => {
    const d = await dropOffLinks(e, T);
    const bh = benjaminiHochberg(d.links.map((l) => l.p), 0.05);
    d.links.forEach((l, i) => {
      expect(l.adjusted).toBeCloseTo(bh.adjusted[i], 14);
      expect(l.flagged).toBe(bh.rejected[i]);
    });
    const flagged = d.links.filter((l) => l.flagged).map((l) => `${l.pain} at ${l.step}`);
    expect(flagged).toContain("shipping_cost at Cart");
    expect(flagged).toContain("site_bugs at Product");
  });

  it("names the segments that carry a pain at the default share of 20 percent, and hides groups under 30", async () => {
    expect(CARRIER_SHARE).toBe(0.2);
    const c = await segmentCarriers(e, T, CARRIER_SHARE);
    const ship = c.filter((x) => x.pain === "shipping_cost").map((x) => [x.segment, x.channel, x.share]);
    expect(ship).toEqual([["new", "ads", 0.5]]);
    expect(c.find((x) => x.pain === "site_bugs")).toEqual({ pain: "site_bugs", segment: "vip", channel: "organic", customers: 40, tagged: 30, share: 0.75 });
    const strict = await segmentCarriers(e, T, 0.6);
    expect(strict.map((x) => x.pain)).toEqual(["site_bugs"]);
  });

  it("assembles one chain per pain, with no test and no decision when no ledger entry names the theme", async () => {
    const chain = assembleChain("shipping_cost", await painRanking(e, T), await dropOffLinks(e, T), await segmentCarriers(e, T, CARRIER_SHARE), []);
    expect(chain.map((s) => s.kind)).toEqual(["theme", "segment", "path", "revenue", "test", "decision"]);
    expect(chain[0].text).toBe("36 comments, 30 of them rated severe.");
    expect(chain[1].text).toBe("new, ads: 50.0 percent of 60 commenting customers raised it.");
    expect(chain[2].text).toMatch(/^At Cart, 50\.0 percent of those who stopped raised it, against 10\.0 percent of those who went on\./);
    expect(chain[3].text).toBe("600 dollars from the 36 customers who raised it. 30 of them did not buy.");
    expect(chain[4].text).toBe("No ledger entry names this theme yet.");
    expect(chain[4].status).toBe("missing");
    expect(chain[5].text).toBe("No decision. A decision needs a test with a holdout behind it.");
    expect(chain.every((s) => s.label.length > 0)).toBe(true);
  });

  it("links a ledger entry that names the theme, and shows its status", () => {
    const entries = [
      { id: "a", title: "Free shipping over 50 dollars", themeId: THEME_IDS.shipping_cost, status: "running" },
      { id: "b", title: "Other", themeId: THEME_IDS.pricing, status: "draft" },
    ];
    const chain = assembleChain("shipping_cost", [], { comparisons: 0, q: 0.05, links: [] }, [], entries);
    expect(chain[4].text).toBe("Free shipping over 50 dollars, running.");
    expect(chain[4].status).toBe("present");
    expect(chain[4].entryId).toBe("a");
  });

  it("reads a theme id back to its theme, and gives null for no theme, no complaint, or an unknown id", () => {
    expect(themeOf(THEME_IDS.shipping_cost)).toBe("shipping_cost");
    expect(themeOf(THEME_IDS.support_slow)).toBe("support_slow");
    expect(themeOf(null)).toBeNull();
    expect(themeOf(THEME_IDS.no_issue)).toBeNull();
    expect(themeOf("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("calls a closed linked test a decision, and an open one not yet", () => {
    const closed = [{ id: "c", title: "Free shipping test", themeId: THEME_IDS.shipping_cost, status: "closed" }];
    const chain = assembleChain("shipping_cost", [], { comparisons: 0, q: 0.05, links: [] }, [], closed);
    expect(chain[5].status).toBe("present");
    expect(chain[5].text).toBe("A test on this theme is closed. Read its result in the ledger.");
    expect(chain[5].entryId).toBe("c");
  });

  it("gives every pain a different fixed UUID as its theme id", () => {
    const ids = Object.values(THEME_IDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("Benjamini Hochberg holds back a link whose raw p value alone would pass", () => {
  // 120 customers reach the Cart. 60 stop there: 30 shipping cost, 13 pricing, 17 no complaint.
  // 60 buy: 6 shipping cost, 5 pricing, 49 no complaint. Nobody stops before the Cart, so only the Cart is compared.
  const journeys = [...Array.from({ length: 60 }, () => person("new", "ads", 3)), ...Array.from({ length: 60 }, () => person("new", "ads", 4))];
  const said: Pain[] = [
    ...Array<Pain>(30).fill("shipping_cost"), ...Array<Pain>(13).fill("pricing"), ...Array<Pain>(17).fill("no_issue"),
    ...Array<Pain>(6).fill("shipping_cost"), ...Array<Pain>(5).fill("pricing"), ...Array<Pain>(49).fill("no_issue"),
  ];
  let e: SqlEngine;
  beforeAll(async () => {
    e = await createNodeEngine({ isolated: true });
    await loadJourneys(e, T.journeys, journeys);
    await loadComments(e, T.comments, said.map((p, i) => row(i, journeys[i], p)));
    await loadRevenue(e, T.revenue, journeys.map(() => 0));
  }, 120_000);
  afterAll(async () => e.close?.());

  it("leaves pricing unflagged at p about 0.04 across 6 comparisons, and still flags shipping cost", async () => {
    const d = await dropOffLinks(e, T);
    expect(d.comparisons).toBe(6);
    const pricing = d.links.find((l) => l.pain === "pricing")!;
    expect(pricing.p).toBeCloseTo(twoProportionPValue(13, 60, 5, 60), 14);
    expect(pricing.p).toBeLessThan(0.05);
    expect(pricing.adjusted).toBeGreaterThan(0.05);
    expect(pricing.flagged).toBe(false);
    expect(d.links.find((l) => l.pain === "shipping_cost")!.flagged).toBe(true);
  });
});

describe("customerRevenue", () => {
  const journeys = syntheticJourneys(5_000, 11);
  it("gives revenue only to customers who bought, is the same for a seed, and stays in a stated range", () => {
    const r = customerRevenue(journeys, 31);
    expect(r).toEqual(customerRevenue(journeys, 31));
    journeys.forEach((j, i) => {
      if (j.reached !== "Purchase") expect(r[i]).toBe(0);
      else {
        expect(Number.isInteger(r[i])).toBe(true);
        expect(r[i]).toBeGreaterThanOrEqual(20);
        expect(r[i]).toBeLessThanOrEqual(400);
      }
    });
  });
});

describe("the evidence chain on the synthetic comments", () => {
  const journeys = syntheticJourneys(20_000, 11);
  const prepared = prepareComments(syntheticComments(journeys, 3_000, 17));
  const revenue = customerRevenue(journeys, 31);
  let e: SqlEngine;
  beforeAll(async () => {
    e = await createNodeEngine({ isolated: true });
    await loadJourneys(e, T.journeys, journeys);
    await loadComments(e, T.comments, prepared.rows);
    await loadRevenue(e, T.revenue, revenue);
  }, 120_000);
  afterAll(async () => e.close?.());

  it("matches an independent count of mentions and revenue for every pain", async () => {
    for (const r of await painRanking(e, T)) {
      const tagged = prepared.rows.filter((c) => c.pain === r.pain);
      expect(r.mentions).toBe(tagged.length);
      expect(r.revenue).toBe(tagged.reduce((n, c) => n + revenue[c.customer], 0));
    }
  });

  it("finds the planted link: shipping cost goes with stopping at the Cart, after correction", async () => {
    const d = await dropOffLinks(e, T);
    const link = d.links.find((l) => l.pain === "shipping_cost" && l.step === "Cart")!;
    expect(link.flagged).toBe(true);
    expect(link.difference).toBeGreaterThan(0);
  });
});
