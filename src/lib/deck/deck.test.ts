import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { formatCount, formatPercent } from "../app/format";
import { assembleChain, THEME_IDS } from "../insights/evidence";
import { buildDeck, deckFileName, readResult, type DeckEntry } from "./deck";
import { renderDeck } from "./pptx";

const RESULT = {
  lift: 0.05,
  interval_low: 0.0203,
  interval_high: 0.0797,
  significant: true,
  alpha: 0.05,
  p_value: 0.0012,
  treatment_rate: 0.15,
  control_rate: 0.1,
  sample_sizes: { treatment: 1000, control: 1000 },
  srm_pass: true,
  computed_at: "2026-11-16T12:00:00.000Z",
  engine_version: "stats-1",
  method: "Newcombe hybrid score interval",
};

const ENTRY: DeckEntry = {
  title: "Synthetic: free shipping over 50 dollars",
  hypothesis: "Free shipping over 50 dollars lifts Cart to Purchase against a holdout.",
  status: "readable",
  entryType: "confirmatory",
  frameworkTag: "PAS",
  registeredAt: "2026-07-14T09:00:00.000Z",
  launchedAt: "2026-07-15T09:00:00.000Z",
  design: { baselineRate: 0.1, minDetectableLift: 0.04, treatmentShare: 0.5, audienceSize: 2000, conversionWindowHours: 168 },
  result: RESULT,
  comparisonsCount: 1,
  correctionMethod: "not_applied",
  synthetic: true,
  provenance: "local",
};

const GENERATED = "2026-11-20T10:00:00.000Z";
const text = (s: { title: string; lines?: string[]; table?: { rows: string[][] } }) =>
  [s.title, ...(s.lines ?? []), ...(s.table?.rows.flat() ?? [])].join("\n");

describe("buildDeck, a confirmatory entry with a result", () => {
  const deck = buildDeck({ entry: ENTRY, generatedAt: GENERATED });

  it("has the slides in order: title, question, design, result, caveats", () => {
    expect(deck.slides.map((s) => s.kind)).toEqual(["title", "question", "design", "result", "caveats"]);
    expect(deck.slides[0].title).toBe(ENTRY.title);
  });

  it("states the numbers exactly as the ledger holds them", () => {
    const result = deck.slides.find((s) => s.kind === "result")!;
    const all = text(result);
    expect(all).toContain(formatPercent(0.15));
    expect(all).toContain(formatPercent(0.1));
    expect(all).toContain(formatCount(1000));
    expect(all).toContain("5.00 points");
    expect(all).toContain("2.03 points");
    expect(all).toContain("7.97 points");
    expect(all).toContain("0.0012");
    expect(result.chart).toEqual({ title: "Conversion rate, percent", labels: ["Treatment", "Control"], values: [15, 10] });
    expect(result.lines!.join(" ")).toContain("Significant: yes");
  });

  it("says the entry is confirmatory and gives the dates and the design", () => {
    expect(text(deck.slides[1])).toContain("Confirmatory");
    expect(text(deck.slides[1])).toContain("registered before it launched");
    expect(text(deck.slides[1])).toContain("2026-07-14");
    expect(text(deck.slides[1])).toContain("2026-07-15");
    expect(text(deck.slides[1])).toContain("PAS");
    const design = text(deck.slides[2]);
    expect(design).toContain("10.00 percent");
    expect(design).toContain("4.00 points");
    expect(design).toContain("2,000");
    expect(design).toContain("7 days");
  });

  it("puts the label, the correction line and the small test warning on the caveats slide", () => {
    const c = text(deck.slides[4]);
    expect(c).toContain("synthetic");
    expect(c).toContain("Comparisons made: 1.");
    expect(c).toContain("No multiple comparison correction applies");
    expect(c).toContain("Newcombe hybrid score interval");
  });

  it("names the interval level from the stored alpha, not a fixed 95", () => {
    const d = buildDeck({ entry: { ...ENTRY, result: { ...RESULT, alpha: 0.1 } }, generatedAt: GENERATED });
    expect(text(d.slides.find((s) => s.kind === "result")!)).toContain("with a 90 percent interval from");
  });

  it("uses no em dash and no parentheses in any slide text", () => {
    for (const s of deck.slides) expect(text(s), s.kind).not.toMatch(/[—()]/);
  });
});

describe("buildDeck, other cases", () => {
  it("labels an exploratory entry as exploratory and explains why", () => {
    const deck = buildDeck({
      entry: { ...ENTRY, entryType: "exploratory", correctionMethod: "exploratory_label", registeredAt: "2026-07-16T09:00:00.000Z" },
      generatedAt: GENERATED,
    });
    expect(text(deck.slides[1])).toContain("Exploratory");
    expect(text(deck.slides[1])).toContain("registered after it launched");
    expect(text(deck.slides.at(-1)!)).toContain("labeled exploratory and is not corrected");
  });

  it("explains an inconclusive result in plain words and does not call it no effect", () => {
    const deck = buildDeck({
      entry: { ...ENTRY, result: { ...RESULT, significant: false, lift: 0.004, interval_low: -0.03, interval_high: 0.038 } },
      generatedAt: GENERATED,
    });
    const r = text(deck.slides.find((s) => s.kind === "result")!);
    expect(r).toContain("Significant: no");
    expect(r).toContain("Inconclusive");
    expect(r).toContain("does not show the send had no effect");
  });

  it("says there is no result yet, with no chart, when the entry has none", () => {
    const deck = buildDeck({ entry: { ...ENTRY, status: "running", result: null, comparisonsCount: null, correctionMethod: null }, generatedAt: GENERATED });
    const r = deck.slides.find((s) => s.kind === "result")!;
    expect(r.chart).toBeUndefined();
    expect(text(r)).toContain("No result has been recorded yet");
  });

  it("adds the evidence chain after the question, labeled association, when a chain is given", () => {
    const chain = assembleChain("shipping_cost", [], { comparisons: 0, q: 0.05, links: [] }, [], [
      { id: "e1", title: ENTRY.title, themeId: THEME_IDS.shipping_cost, status: "closed" },
    ]);
    const deck = buildDeck({ entry: ENTRY, chain, chainTitle: "Shipping costs too much", generatedAt: GENERATED });
    expect(deck.slides.map((s) => s.kind)).toEqual(["title", "question", "chain", "design", "result", "caveats"]);
    const c = deck.slides[2];
    expect(c.title).toBe("Evidence chain: Shipping costs too much");
    expect(c.table!.rows).toHaveLength(6);
    expect(c.table!.rows.map((r) => r[0])).toEqual(chain.map((s) => s.label));
    expect(c.table!.rows[4][2]).toContain(ENTRY.title);
    expect(text(deck.slides.at(-1)!)).toContain("association, not a cause");
  });

  it("notes an imported entry's times are not verified", () => {
    const deck = buildDeck({ entry: { ...ENTRY, provenance: "imported" }, generatedAt: GENERATED });
    expect(text(deck.slides.at(-1)!)).toContain("times are not verified");
  });

  it("refuses a result that is not the shape the ledger stores, rather than printing a wrong number", () => {
    expect(() => readResult({ ...RESULT, lift: "big" })).toThrow(RangeError);
    expect(() => readResult({ ...RESULT, sample_sizes: null })).toThrow(RangeError);
    expect(() => buildDeck({ entry: { ...ENTRY, result: { lift: 1 } }, generatedAt: GENERATED })).toThrow(RangeError);
    expect(readResult(null)).toBeNull();
  });

  it("names the file from the title and the date, with nothing that could break a path", () => {
    expect(deckFileName("Synthetic: free shipping over 50 dollars", GENERATED)).toBe("decision-deck-synthetic-free-shipping-over-50-dollars-2026-11-20.pptx");
    expect(deckFileName('../..\\"<>|*?', GENERATED)).toBe("decision-deck-test-2026-11-20.pptx");
    expect(deckFileName("x".repeat(200), GENERATED).length).toBeLessThanOrEqual(90);
  });
});

describe("renderDeck, the real .pptx file", () => {
  it("makes a zip with one slide per model slide, holding the same numbers, and a native chart with the two rates", async () => {
    const deck = buildDeck({ entry: ENTRY, generatedAt: GENERATED });
    const bytes = await renderDeck(deck);
    expect(bytes.byteLength).toBeGreaterThan(5_000);
    // A .pptx is a zip, so it starts with the zip signature.
    expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b]);
    const zip = await JSZip.loadAsync(bytes);
    const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    expect(slides).toHaveLength(deck.slides.length);
    const xml = await Promise.all(slides.sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0])).map((f) => zip.file(f)!.async("string")));
    // Each slide's title and a number from it are in its XML, after XML escaping.
    deck.slides.forEach((s, i) => expect(xml[i]).toContain(s.title.replace(/&/g, "&amp;")));
    expect(xml[3]).toContain("15.00 percent");
    expect(xml[3]).toContain("Significant: yes");
    const charts = Object.keys(zip.files).filter((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f));
    expect(charts).toHaveLength(1);
    const chartXml = await zip.file(charts[0])!.async("string");
    expect(chartXml).toContain("Treatment");
    expect(chartXml).toContain("<c:v>15</c:v>");
    expect(chartXml).toContain("<c:v>10</c:v>");
  });

  it("escapes text that looks like markup, so a title cannot break the file", async () => {
    const deck = buildDeck({ entry: { ...ENTRY, title: "A & B <script>x</script>" }, generatedAt: GENERATED });
    const zip = await JSZip.loadAsync(await renderDeck(deck));
    const first = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(first).toContain("A &amp; B &lt;script&gt;x&lt;/script&gt;");
    expect(first).not.toContain("<script>");
  });
});
