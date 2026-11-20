import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { syntheticJourneys } from "../demo/journeys";
import { syntheticComments } from "../insights/comments";
import { prepareComments } from "../insights/prepare";
import { createCoder } from "./coder";
import { chooseThreshold, scoreCoding } from "./eval";
import { MEASURED } from "./measured";
import { nodeEmbed } from "./testing/node-embed";
import { HELD_OUT, TUNE } from "./testdata/eval-comments";

describe("chooseThreshold and scoreCoding, on numbers worked out by hand", () => {
  it("picks the cut that maximizes right minus wrong answers, preferring the lower cut on a tie", () => {
    // Above 0.6: two right, one wrong. Between 0.4 and 0.6: one wrong. Below 0.4: one right.
    const tune = [
      { score: 0.8, right: true },
      { score: 0.7, right: true },
      { score: 0.65, right: false },
      { score: 0.5, right: false },
      { score: 0.3, right: true },
    ];
    // Cut at 0.65: 2 - 1 = 1. Cut at 0.7: 2. Cut at 0.3: 3 - 2 = 1. So 0.7 wins.
    expect(chooseThreshold(tune)).toBeCloseTo(0.7, 6);
    expect(chooseThreshold([{ score: 0.5, right: true }, { score: 0.4, right: true }])).toBeCloseTo(0.4, 6);
    expect(() => chooseThreshold([])).toThrow(RangeError);
  });

  it("counts an uncertain answer against accuracy, and reports coverage and the baseline", () => {
    const set = [
      { text: "a", theme: "pricing" as const },
      { text: "b", theme: "pricing" as const },
      { text: "c", theme: "site_bugs" as const },
      { text: "d", theme: "no_issue" as const },
    ];
    const coded = [
      { theme: "pricing" as const, score: 0.9, margin: 0.1, quote: { start: 0, end: 1, text: "a" } },
      { theme: null, score: 0.1, margin: 0, quote: null },
      { theme: "pricing" as const, score: 0.8, margin: 0.1, quote: { start: 0, end: 1, text: "c" } },
      { theme: "no_issue" as const, score: 0.7, margin: 0.2, quote: { start: 0, end: 1, text: "d" } },
    ];
    const r = scoreCoding(set, coded);
    expect([r.correct, r.wrong, r.uncertain, r.answered]).toEqual([2, 1, 1, 3]);
    expect(r.accuracy).toBe(0.5);
    expect(r.coverage).toBe(0.75);
    expect(r.accuracyWhenAnswered).toBeCloseTo(2 / 3, 12);
    expect(r.baseline).toBe(0.5);
    expect(r.perTheme.find((p) => p.theme === "pricing")).toMatchObject({ n: 2, correct: 1, predicted: 2, recall: 0.5, precision: 0.5 });
  });
});

describe("theme coding with the real model, run in Node from the downloaded files", () => {
  it("is measured on the held out set with a cut chosen on the tuning set only, and beats always guessing", { timeout: 180_000 }, async () => {
    const embed = await nodeEmbed();
    const open = await createCoder(embed, -0.99);
    const tuneCoded = await open.codeMany(TUNE.map((t) => t.text));
    const cut = chooseThreshold(tuneCoded.map((c, i) => ({ score: c.score, right: c.theme === TUNE[i].theme })));
    const coder = await createCoder(embed, cut);
    const held = scoreCoding(HELD_OUT, await coder.codeMany(HELD_OUT.map((h) => h.text)));

    // Every answer quotes the comment's own words. createCoder already refuses anything else.
    for (const r of held.rows) if (r.quote !== null) expect(r.text).toContain(r.quote);

    // The generator's comments are written from templates, an easy case, so they are reported apart.
    const journeys = syntheticJourneys(2_000, 11);
    const gen = prepareComments(syntheticComments(journeys, 300, 17)).rows;
    const genScore = scoreCoding(gen.map((g) => ({ text: g.quote.text, theme: g.pain })), await coder.codeMany(gen.map((g) => g.quote.text)));

    const pct = (x: number) => `${(x * 100).toFixed(1)} percent`;
    const report = [
      `Cut chosen on ${TUNE.length} tuning comments: ${cut.toFixed(3)}.`,
      `Held out, ${held.n} comments: accuracy ${pct(held.accuracy)}, coverage ${pct(held.coverage)}, accuracy when answered ${pct(held.accuracyWhenAnswered)}, always guessing the top label ${pct(held.baseline)}.`,
      `Right ${held.correct}, wrong ${held.wrong}, uncertain ${held.uncertain}.`,
      ...held.perTheme.map((p) => `  ${p.theme}: recall ${p.correct} of ${p.n}, precision ${p.correct} of ${p.predicted}`),
      "Misses:",
      ...held.rows.filter((r) => r.got !== r.expected).map((r) => `  expected ${r.expected}, got ${r.got ?? "uncertain"} at ${r.score.toFixed(3)}: ${JSON.stringify(r.text)}`),
      `Generator comments, ${genScore.n}: accuracy ${pct(genScore.accuracy)}, coverage ${pct(genScore.coverage)}.`,
    ];
    if (process.env.EVAL_REPORT) writeFileSync(process.env.EVAL_REPORT, report.join("\n"));

    expect(held.accuracy).toBeGreaterThan(held.baseline);
    // Measured on 2026-11-20 in Node: 49 of 56 right, 5 wrong, 2 uncertain, and 81.7 percent on 251 generator comments.
    // A change that loses one fails here. The same person wrote the comments and the theme descriptions, so real text
    // will likely score lower. The browser runs the same model through WebAssembly, and its numbers can differ slightly.
    expect(held.correct).toBeGreaterThanOrEqual(49);
    expect(genScore.correct).toBeGreaterThanOrEqual(205);
    // The screen quotes MEASURED, so it must be exactly what this run measured.
    expect(Number(cut.toFixed(3))).toBe(MEASURED.threshold);
    expect({ n: held.n, correct: held.correct, wrong: held.wrong, uncertain: held.uncertain }).toEqual(MEASURED.heldOut);
    expect({ n: genScore.n, correct: genScore.correct }).toEqual(MEASURED.generator);
    // Instructions planted in a comment do not move the coding.
    for (const r of held.rows.filter((x) => /Ignore all previous instructions|System note/.test(x.text))) expect(r.got, r.text).toBe(r.expected);
  });
});
