import { describe, expect, it } from "vitest";
import { NO_FILTER, filterEntries, type EntryFilter } from "./filter";
import type { LedgerEntry } from "./ledger";

let n = 0;
const entry = (over: Partial<LedgerEntry>): LedgerEntry => ({
  id: `id-${++n}`,
  workspaceId: "w",
  title: "Untitled",
  hypothesis: "",
  registeredAt: null,
  launchedAt: null,
  entryType: null,
  themeId: null,
  segmentId: null,
  journeyId: null,
  frameworkTag: null,
  design: null,
  powerResult: null,
  result: null,
  comparisonsCount: null,
  correctionMethod: null,
  status: "draft",
  provenance: "local",
  synthetic: false,
  ...over,
});

const list = [
  entry({ title: "Win back offer", status: "readable", entryType: "confirmatory", frameworkTag: "PAS" }),
  entry({ title: "Subject line test", status: "running", entryType: "exploratory", frameworkTag: "AIDA" }),
  entry({ title: "Welcome series", status: "draft", entryType: null, frameworkTag: null, hypothesis: "Shorter is better for new subscribers" }),
  entry({ title: "Cart reminder", status: "registered", entryType: null, frameworkTag: "FAB" }),
  entry({ title: "Holiday offer", status: "readable", entryType: "exploratory", frameworkTag: null }),
];
const titles = (f: Partial<EntryFilter>) => filterEntries(list, { ...NO_FILTER, ...f }).map((e) => e.title);

describe("filterEntries", () => {
  it("keeps everything, in order, when nothing is chosen", () => {
    expect(titles({})).toEqual(list.map((e) => e.title));
  });

  it("filters by status", () => {
    expect(titles({ status: "readable" })).toEqual(["Win back offer", "Holiday offer"]);
    expect(titles({ status: "draft" })).toEqual(["Welcome series"]);
    expect(titles({ status: "closed" })).toEqual([]);
  });

  it("filters by type, and finds entries whose type is not set", () => {
    expect(titles({ type: "confirmatory" })).toEqual(["Win back offer"]);
    expect(titles({ type: "exploratory" })).toEqual(["Subject line test", "Holiday offer"]);
    expect(titles({ type: "none" })).toEqual(["Welcome series", "Cart reminder"]);
  });

  it("filters by framework tag, and finds entries with no tag", () => {
    expect(titles({ tag: "PAS" })).toEqual(["Win back offer"]);
    expect(titles({ tag: "AIDA" })).toEqual(["Subject line test"]);
    expect(titles({ tag: "none" })).toEqual(["Welcome series", "Holiday offer"]);
  });

  it("combines filters with AND", () => {
    expect(titles({ status: "readable", type: "exploratory" })).toEqual(["Holiday offer"]);
    expect(titles({ status: "readable", type: "confirmatory", tag: "AIDA" })).toEqual([]);
  });

  it("searches title and hypothesis, ignoring case and surrounding spaces", () => {
    expect(titles({ text: "  OFFER " })).toEqual(["Win back offer", "Holiday offer"]);
    expect(titles({ text: "subscribers" })).toEqual(["Welcome series"]);
    expect(titles({ text: "nothing like this" })).toEqual([]);
    expect(titles({ text: "   " })).toEqual(list.map((e) => e.title));
  });

  it("does not change the list it was given", () => {
    const before = list.map((e) => e.id);
    filterEntries(list, { ...NO_FILTER, status: "readable" });
    expect(list.map((e) => e.id)).toEqual(before);
  });

  it("treats text as plain text, so characters that mean something in a pattern do not", () => {
    expect(titles({ text: ".*" })).toEqual([]);
    expect(titles({ text: "(" })).toEqual([]);
  });
});
