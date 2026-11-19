import { anchoredFlow } from "../charts/anchored";
import type { Comparison } from "../charts/compare";
import type { Timing } from "../charts/timing";
import type { BehindStep } from "../charts/behind";
import type { ExampleJourney } from "../charts/replay";
import { describe, expect, it } from "vitest";
import type { CohortRow, DwellHistogram, FunnelStage, Outlook, PeriodComparison, Stalled } from "../charts/pipeline";
import type { TopPaths } from "../charts/crossfilter";
import { whatIf } from "../charts/whatif";
import { formatCount, formatPercent } from "./format";
import {
  explainCohorts,
  explainDwell,
  explainFunnel,
  explainOutlook,
  explainAnchored,
  explainComparison,
  explainTiming,
  explainBehind,
  explainReplay,
  explainPaths,
  explainPeriods,
  explainStalled,
  explainWhatIf,
} from "./explain-views";

const find = <T extends { label: string }>(list: T[], label: string): T => list.find((e) => e.label === label)!;
const clean = (list: { label: string; value: string; how: string }[]) => {
  for (const e of list) expect(`${e.label} ${e.value} ${e.how}`).not.toMatch(/[—()]/);
};

describe("explainFunnel", () => {
  const funnel: FunnelStage[] = [
    { stage: "Lead", count: 1000, conversion: 1 },
    { stage: "Qualified", count: 500, conversion: 0.5 },
    { stage: "Proposal", count: 300, conversion: 0.6 },
    { stage: "Won", count: 90, conversion: 0.3 },
  ];
  const list = explainFunnel(funnel);

  it("explains each stage as a count and the share of the stage before it", () => {
    const proposal = find(list, "Proposal");
    expect(proposal.value).toBe(`${formatCount(300)} deals, ${formatPercent(0.6, 1)} of the stage before`);
    expect(proposal.how).toContain("300 of the 500 deals that reached Qualified");
    expect(proposal.how).toContain("60.0 percent");
  });

  it("says the first stage is everyone who matches the filters", () => {
    expect(find(list, "Lead").how).toMatch(/everyone who matches the filters/);
  });

  it("is clean text and handles an empty stage", () => {
    clean(list);
    const empty = explainFunnel([
      { stage: "Lead", count: 0, conversion: 1 },
      { stage: "Qualified", count: 0, conversion: 0 },
    ]);
    expect(find(empty, "Qualified").how).toMatch(/no deals reached/);
  });
});

describe("explainDwell", () => {
  const h: DwellHistogram = {
    from: "Proposal",
    to: "Won",
    moved: 1517,
    binDays: 3,
    bins: [{ fromDay: 0, count: 100 }],
    medianDays: 26.6,
    p90Days: 62.7,
  };
  const list = explainDwell(h);

  it("explains the count, the median and the 90th percentile in plain words", () => {
    expect(find(list, "Deals that moved").value).toBe("1,517");
    expect(find(list, "Median").value).toBe("26.6 days");
    expect(find(list, "Median").how).toMatch(/half of these deals took less/);
    expect(find(list, "90th percentile").value).toBe("62.7 days");
    expect(find(list, "90th percentile").how).toMatch(/nine in ten/);
  });

  it("warns that deals still waiting are left out, so slow stages look faster than they are", () => {
    expect(find(list, "Deals that moved").how).toMatch(/still waiting are not in it/);
    clean(list);
  });
});

describe("explainStalled", () => {
  const stalled: Stalled[] = [
    { stage: "Lead", count: 1590, medianIdleDays: 52.8 },
    { stage: "Proposal", count: 876, medianIdleDays: 52.4 },
  ];
  const list = explainStalled(stalled, { thresholdDays: 30, asOf: "2026-11-01T00:00:00Z" });

  it("totals the stalled deals and explains the rule, with the cutoff", () => {
    const total = find(list, "Stalled deals");
    expect(total.value).toBe("2,466");
    expect(total.how).toContain("30 days");
    expect(total.how).toContain("2026-11-01");
    expect(total.how).toMatch(/not won and not lost/);
  });

  it("explains idle time as elapsed time since the last stage entry, per stage", () => {
    const lead = find(list, "Stuck in Lead");
    expect(lead.value).toBe("1,590 deals, median 52.8 days idle");
    expect(lead.how).toMatch(/elapsed time since the deal last entered a stage/);
    clean(list);
  });

  it("says plainly when nothing is stalled", () => {
    const none = explainStalled([], { thresholdDays: 60, asOf: "2026-11-01T00:00:00Z" });
    expect(find(none, "Stalled deals").value).toBe("0");
  });
});

describe("explainCohorts", () => {
  const row = (cohort: string, mature: boolean): CohortRow => ({
    cohort,
    deals: 9481,
    reachedQualified: 5320,
    reachedProposal: 3148,
    reachedWon: 1270,
    qualifiedShare: 5320 / 9481,
    proposalShare: 3148 / 9481,
    wonShare: 1270 / 9481,
    mature,
    latestEntry: "2026-03-31T23:00:00.000Z",
  });
  const list = explainCohorts([row("2026-03", true), row("2026-10", false)], 60);

  it("walks through the first comparable month with its real counts", () => {
    const first = find(list, "Example: 2026-03");
    expect(first.how).toContain("5,320 of 9,481 deals");
    expect(first.how).toContain(formatPercent(5320 / 9481, 1));
    expect(first.how).toContain("within 60 days");
  });

  it("explains maturity and names the months still maturing", () => {
    const m = find(list, "Still maturing");
    expect(m.value).toBe("1 month");
    expect(m.how).toContain("2026-10");
    expect(m.how).toMatch(/not had the whole window/);
    clean(list);
  });

  it("handles no comparable month", () => {
    const only = explainCohorts([row("2026-10", false)], 60);
    expect(only.some((e) => e.label.startsWith("Example"))).toBe(false);
  });
});

describe("explainPeriods", () => {
  const c: PeriodComparison = {
    windowDays: 60,
    earlier: { from: "2026-03-04T00:00:00.000Z", to: "2026-06-03T00:00:00.000Z", deals: 27489, comparable: true, latestEntry: null },
    later: { from: "2026-06-03T00:00:00.000Z", to: "2026-09-02T00:00:00.000Z", deals: 27547, comparable: true, latestEntry: null },
    comparable: true,
    alpha: 0.05,
    method: "",
    rows: [
      {
        stage: "Qualified",
        earlier: { reached: 15450, share: 15450 / 27489 },
        later: { reached: 17740, share: 17740 / 27547 },
        difference: 17740 / 27547 - 15450 / 27489,
        interval: { low: 0.073, high: 0.09 },
        significant: true,
      },
    ],
  };
  const list = explainPeriods(c);

  it("shows both shares as a count over the deals in the period, and the difference", () => {
    const q = find(list, "Qualified");
    expect(q.how).toContain("15,450 of 27,489 deals");
    expect(q.how).toContain("17,740 of 27,547 deals");
    expect(q.value).toMatch(/^\+\d\.\d points$/);
    expect(q.how).toMatch(/Newcombe hybrid score/);
    expect(q.how).toMatch(/excludes zero/);
    clean(list);
  });

  it("says when the interval includes zero, and when a period is not comparable", () => {
    const flat = explainPeriods({ ...c, rows: [{ ...c.rows[0], significant: false, interval: { low: -0.01, high: 0.02 } }] });
    expect(find(flat, "Qualified").how).toMatch(/includes zero/);
    const young = explainPeriods({ ...c, comparable: false, later: { ...c.later, comparable: false } });
    expect(find(young, "Comparable").value).toBe("no");
  });
});

describe("explainPaths", () => {
  const r: TopPaths = {
    total: 100000,
    minShare: 0.02,
    paths: [{ path: "Visit > Product", count: 24930, share: 0.2493, endsAt: "Product", endsInPurchase: false }],
    other: { count: 4110, share: 0.0411, paths: 3 },
  };
  const list = explainPaths(r);

  it("explains a path share as customers over all customers, and the merged group", () => {
    expect(find(list, "Visit > Product").how).toContain("24,930 of 100,000 customers");
    const other = find(list, "Other paths");
    expect(other.value).toBe("4,110 customers in 3 routes");
    expect(other.how).toContain("2 percent");
    expect(other.how).toMatch(/so the totals still add up/);
    clean(list);
  });

  it("leaves out the merged group when nothing was merged", () => {
    const none = explainPaths({ ...r, other: { count: 0, share: 0, paths: 0 } });
    expect(none.some((e) => e.label === "Other paths")).toBe(false);
  });
});

describe("explainWhatIf", () => {
  const stages = [
    { stage: "Visit", count: 1000 },
    { stage: "Product", count: 500 },
    { stage: "Cart", count: 250 },
    { stage: "Purchase", count: 100 },
  ];
  const s = whatIf(stages, { fromStep: 1, points: 10 });
  const list = explainWhatIf(s, stages);

  it("shows the current rate as a count over a count, and the new rate", () => {
    const rate = find(list, "Product to Cart");
    expect(rate.how).toContain("250 of 500");
    expect(rate.how).toContain("50.0 percent");
    expect(rate.how).toContain("60.0 percent");
  });

  it("carries the gain through the later steps with the real figures", () => {
    const carried = find(list, "Carried to Purchase");
    expect(carried.how).toContain("300");
    expect(carried.how).toContain("40.0 percent");
    expect(carried.value).toBe("120 people, 20 more");
    expect(carried.how).toMatch(/not a forecast/);
    clean(list);
  });
});

describe("explainOutlook", () => {
  const outlook: Outlook = {
    thresholdDays: 30,
    stages: [
      { stage: "Lead", active: 1000, stalled: 600, resolved: 40000, won: 6000, rate: 0.15, rateLow: 0.146, rateHigh: 0.154, expected: 150, low: 146, high: 154 },
      { stage: "Proposal", active: 400, stalled: 200, resolved: 10000, won: 4300, rate: 0.43, rateLow: 0.42, rateHigh: 0.44, expected: 172, low: 168, high: 176 },
    ],
    totals: { active: 1400, stalled: 800, expected: 322, low: 314, high: 330, chanceSpread: 11.4 },
  };
  const list = explainOutlook(outlook);

  it("explains each stage's rate as won over resolved deals, and the expected wins as active deals times that rate", () => {
    const p = find(list, "Proposal");
    expect(p.how).toContain("4,300 of the 10,000 deals");
    expect(p.how).toContain("43.0 percent");
    expect(p.how).toContain("400 active deals");
    expect(p.value).toBe("172 expected wins");
    clean(list);
  });

  it("shows the total with its range, and the spread from chance, as two different kinds of uncertainty", () => {
    const t = find(list, "Expected wins in total");
    expect(t.value).toBe("322, range 314 to 330");
    expect(t.how).toMatch(/not knowing the win rates exactly/);
    expect(find(list, "Spread from chance").value).toBe("about 11 either way");
    expect(find(list, "Spread from chance").how).toMatch(/even with the rates exactly right/);
  });

  it("says which deals are left out and why, and that it is a planning aid", () => {
    const s = find(list, "Stalled deals left out");
    expect(s.value).toBe("800");
    expect(s.how).toContain("30 days");
    expect(s.how).toMatch(/much less likely to win/);
    expect(find(list, "What it assumes").how).toMatch(/not a forecast/);
  });
});

describe("explainAnchored", () => {
  const flow = anchoredFlow(
    [
      { path: ["Visit", "Product", "Cart", "Purchase"], count: 50 },
      { path: ["Visit", "Product", "Cart", "Support", "Purchase"], count: 10 },
      { path: ["Visit", "Product", "Cart"], count: 15 },
      { path: ["Visit", "Product"], count: 40 },
    ],
    { anchor: "Cart", before: 1, after: 1, topN: 1 },
  );
  const list = explainAnchored(flow);

  it("says how many did the anchor, out of how many, and that each is counted once", () => {
    const e = find(list, "Customers");
    expect(e.value).toBe("75 of 115");
    expect(e.how).toContain("Cart");
    expect(e.how).toContain("first time");
  });

  it("explains each step after, the grouped events and the people whose path ended", () => {
    const next = find(list, "Step +1");
    expect(next.value).toBe("60 of 75 customers went on");
    expect(next.how).toContain("Purchase 50");
    expect(next.how).toContain("1 other kind of event, 10 customers");
    const ended = find(list, "Ended after anchor");
    expect(ended.value).toBe("15 customers");
    expect(ended.how).toContain("has not acted yet");
  });

  it("keeps the words plain", () => clean(list));
});

describe("explainComparison", () => {
  const group = (value: string, from: number, to: number) => ({
    value,
    entered: from,
    reached: [from, to, 0, 0],
    rates: [{ step: "Visit to Product", from, to, rate: to / from, low: 0.5, high: 0.7 }],
    tooSmall: false,
  });
  const c = {
    dimension: "segment",
    a: group("new", 200, 160),
    b: group("returning", 100, 90),
    differences: [{ step: "Visit to Product", difference: -0.1, low: -0.18, high: -0.02, excludesZero: true }],
    comparisons: 1,
    note: "Comparisons made: 1. Every result here is labeled exploratory and is an association, not cause.",
  } as unknown as Comparison;
  const list = explainComparison(c);

  it("works one step rate through with the real counts", () => {
    const e = find(list, "Step rate");
    expect(e.how).toContain("160 of 200");
    expect(e.how).toContain("80.00 percent");
    expect(e.how).toContain("new");
  });

  it("names both interval methods, and the number of comparisons with the exploratory label", () => {
    expect(find(list, "Interval on a rate").how).toContain("Wilson");
    expect(find(list, "Difference").how).toContain("Newcombe");
    const n = find(list, "Comparisons made");
    expect(n.value).toBe("1");
    expect(n.how).toContain("exploratory");
  });

  it("says the small group rule is a judgment", () => {
    const s = find(list, "Small groups");
    expect(s.value).toBe("30 people");
    expect(s.how).toContain("judgment");
  });

  it("keeps the words plain", () => clean(list));
});

describe("explainTiming", () => {
  const step = (s: string, waiting: number, dropped: number) => ({
    step: s, moved: 10, medianHours: 2, p10Hours: 1, p25Hours: 1.5, p75Hours: 3, p90Hours: 4, waiting, dropped,
  });
  const t: Timing = { asOf: "2026-10-15T00:00:00.000Z", windowHours: 168, steps: [step("Visit to Product", 2, 5), step("Product to Cart", 1, 3)] };
  const list = explainTiming(t);

  it("says how the spread is measured and that Cart to Purchase includes detours", () => {
    const e = find(list, "Time between steps");
    expect(e.how).toContain("reached both steps");
    expect(e.how).toContain("Support detour");
  });

  it("adds up still waiting and dropped across steps, and states the window and the cutoff", () => {
    const w = find(list, "Still waiting");
    expect(w.value).toBe("3");
    expect(w.how).toContain("7 day window");
    expect(w.how).toContain("2026-10-15");
    expect(find(list, "Dropped").value).toBe("8");
  });

  it("says the demo times are assumed, and where the assumptions are", () => {
    expect(find(list, "Synthetic timing").how).toContain("twice as long");
  });

  it("keeps the words plain", () => clean(list));
});

describe("explainBehind", () => {
  const b: BehindStep = {
    step: "Cart", next: "Purchase", reached: 175, movedOn: 114, left: 61, minGroup: 30,
    groups: [
      { label: "new, ads", segment: "new", channel: "ads", reached: 100, movedOn: 60, left: 40, rate: 0.6, low: 0.5, high: 0.7, merged: false, mergedGroups: 0, hidden: false },
      { label: "2 smaller groups, merged", segment: null, channel: null, reached: null, movedOn: null, left: null, rate: null, low: null, high: null, merged: true, mergedGroups: 2, hidden: true },
    ],
  };
  const list = explainBehind(b);

  it("adds the step up from the real counts", () => {
    const e = find(list, "People at this step");
    expect(e.value).toBe("175");
    expect(e.how).toContain("114 went on to Purchase and 61 left at Cart");
  });

  it("says only aggregates are shown and how small groups are merged and hidden", () => {
    const p = find(list, "Privacy");
    expect(p.how).toContain("No individual person");
    expect(p.how).toContain("30");
    expect(p.how).toContain("hidden");
  });

  it("names the interval method on the rate of going on", () => {
    expect(find(list, "Rate of going on").how).toContain("Wilson");
  });

  it("keeps the words plain", () => clean(list));
});

describe("explainReplay", () => {
  const j: ExampleJourney = {
    hidden: false, groupSize: 5000, minGroup: 30, label: "Synthetic customer 12", segment: "new", channel: "ads",
    events: [], position: 1, of: 5000,
  };
  const list = explainReplay(j);

  it("says the customer is made up and the data holds no email or name", () => {
    const e = find(list, "Synthetic customer");
    expect(e.value).toBe("Synthetic customer 12");
    expect(e.how).toContain("no email or name");
  });

  it("states the group rule with the real numbers", () => {
    const p = find(list, "Privacy");
    expect(p.how).toContain("at least 30 people");
    expect(p.how).toContain("5,000");
  });

  it("says times are UTC", () => {
    expect(find(list, "Times").how).toContain("UTC");
  });

  it("keeps the words plain", () => clean(list));
});
