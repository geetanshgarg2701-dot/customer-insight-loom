import { describe, expect, it } from "vitest";
import { mulberry32 } from "../stats/honesty";
import {
  MAX_LINK_LENGTH,
  decodeJourneyView,
  decodePipelineView,
  encodeJourneyView,
  encodePipelineView,
  type JourneyView,
  type PipelineView,
} from "./view-state";

const journey: JourneyView = {
  selection: { segment: ["new", "vip"], channel: ["ads"] },
  compare: { dim: "channel", a: "ads", b: "email" },
  windowHours: 720,
  behindIndex: 1,
  replayReached: "Cart",
  anchor: "Search",
  before: 2,
  after: 3,
  topN: Infinity,
};

describe("journey view links", () => {
  it("round trips a full view exactly", () => {
    const text = encodeJourneyView(journey);
    expect(decodeJourneyView(text)).toEqual({ view: journey, ignored: [] });
  });

  it("round trips an empty selection and the default choices", () => {
    const plain: JourneyView = { ...journey, selection: {}, topN: 3 };
    expect(decodeJourneyView(encodeJourneyView(plain)).view).toEqual(plain);
  });

  it("uses only plain characters, so a link survives being pasted anywhere", () => {
    expect(encodeJourneyView(journey)).toMatch(/^[A-Za-z0-9._,=&-]+$/);
  });

  it("accepts a leading hash sign, as the address bar gives it", () => {
    expect(decodeJourneyView("#" + encodeJourneyView(journey)).view).toEqual(journey);
  });

  it("ignores values that are not in the fixed lists, and says which it ignored", () => {
    const r = decodeJourneyView("v=1&f.segment=new,hacker&f.channel=%3Cscript%3E&w=999&b=9&r=Refund&an=Bogus&bf=7&af=-1&tn=4");
    expect(r.view.selection).toEqual({ segment: ["new"] });
    expect(r.view.windowHours).toBeUndefined();
    expect(r.view.behindIndex).toBeUndefined();
    expect(r.view.replayReached).toBeUndefined();
    expect(r.view.anchor).toBeUndefined();
    expect(r.view.before).toBeUndefined();
    expect(r.view.after).toBeUndefined();
    expect(r.view.topN).toBeUndefined();
    expect(r.ignored.sort()).toEqual(["af", "an", "b", "bf", "f.channel", "f.segment", "r", "tn", "w"].sort());
  });

  it("never lets text from the link reach anything but a comparison against a fixed list", () => {
    const r = decodeJourneyView("v=1&cmp=segment.new.' OR '1'='1&f.segment=new'; DROP TABLE journeys;--");
    expect(r.view.compare).toBeUndefined();
    expect(r.view.selection).toEqual({});
  });

  it("refuses a comparison of a group with itself, or groups from the wrong dimension", () => {
    expect(decodeJourneyView("v=1&cmp=segment.new.new").view.compare).toBeUndefined();
    expect(decodeJourneyView("v=1&cmp=segment.ads.email").view.compare).toBeUndefined();
    expect(decodeJourneyView("v=1&cmp=segment.new.returning").view.compare).toEqual({ dim: "segment", a: "new", b: "returning" });
  });

  it("gives nothing for a link of another version, an empty link, or one that is too long", () => {
    expect(decodeJourneyView("v=2&w=168")).toEqual({ view: {}, ignored: ["v"] });
    expect(decodeJourneyView("")).toEqual({ view: {}, ignored: [] });
    expect(decodeJourneyView("v=1&" + "f.segment=new&".repeat(200))).toEqual({ view: {}, ignored: ["length"] });
    expect(MAX_LINK_LENGTH).toBeGreaterThanOrEqual(encodeJourneyView(journey).length);
  });

  it("keeps each filter to its known values once, and no more than there are", () => {
    const r = decodeJourneyView("v=1&f.segment=new,new,new,returning,vip,new,returning,vip");
    expect(r.view.selection).toEqual({ segment: ["new", "returning", "vip"] });
  });

  it("survives random valid views and random garbage without throwing or inventing values", () => {
    const rng = mulberry32(20261119);
    const pick = <T,>(list: readonly T[]) => list[Math.floor(rng() * list.length)];
    for (let n = 0; n < 300; n++) {
      const v: JourneyView = {
        selection: rng() < 0.5 ? { segment: [pick(["new", "returning", "vip"])] } : {},
        compare: { dim: "segment", a: "new", b: pick(["returning", "vip"]) },
        windowHours: pick([168, 720] as const),
        behindIndex: pick([0, 1, 2, 3] as const),
        replayReached: pick(["Visit", "Product", "Cart", "Purchase"]),
        anchor: pick(["Visit", "Search", "Product", "Cart", "Support", "Purchase"]),
        before: pick([0, 1, 2, 3] as const),
        after: pick([0, 1, 2, 3] as const),
        topN: pick([3, 5, Infinity] as const),
      };
      expect(decodeJourneyView(encodeJourneyView(v)).view).toEqual(v);
      const junk = Array.from({ length: 1 + Math.floor(rng() * 40) }, () => String.fromCharCode(32 + Math.floor(rng() * 95))).join("");
      const r = decodeJourneyView(junk);
      expect(Object.keys(r.view).every((k) => ["selection", "compare", "windowHours", "behindIndex", "replayReached", "anchor", "before", "after", "topN"].includes(k))).toBe(true);
    }
  });
});

describe("pipeline view links", () => {
  const pipeline: PipelineView = {
    selection: { segment: ["enterprise"], status: ["open"], source: ["inbound", "referral"], stage: ["Proposal"] },
    stageStep: 1,
    threshold: 60,
    cohortWindow: 90,
    recStage: 3,
    recWhich: "open",
    scrubDate: "2026-06-14",
  };

  it("round trips a full view exactly", () => {
    expect(decodePipelineView(encodePipelineView(pipeline))).toEqual({ view: pipeline, ignored: [] });
  });

  it("ignores unknown values and a date that is not a date", () => {
    const r = decodePipelineView("v=1&f.segment=huge&st=7&th=5&cw=45&rs=9&rw=all&sd=yesterday&f.status=won");
    expect(r.view.selection).toEqual({ status: ["won"] });
    expect(r.view.stageStep).toBeUndefined();
    expect(r.view.threshold).toBeUndefined();
    expect(r.view.cohortWindow).toBeUndefined();
    expect(r.view.recStage).toBeUndefined();
    expect(r.view.recWhich).toBeUndefined();
    expect(r.view.scrubDate).toBeUndefined();
    expect(r.ignored.sort()).toEqual(["cw", "f.segment", "rs", "rw", "sd", "st", "th"].sort());
  });

  it("refuses an impossible calendar date such as February 30", () => {
    expect(decodePipelineView("v=1&sd=2026-02-30").view.scrubDate).toBeUndefined();
    expect(decodePipelineView("v=1&sd=2026-02-28").view.scrubDate).toBe("2026-02-28");
  });

  it("uses only plain characters", () => {
    expect(encodePipelineView(pipeline)).toMatch(/^[A-Za-z0-9._,=&-]+$/);
  });
});
