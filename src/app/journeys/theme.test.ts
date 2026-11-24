import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DARK_CHART, LIGHT_CHART, barEmphasis, barItem } from "./theme";

const CSS = readFileSync("src/app/globals.css", "utf8");
const tokens = (block: string) => Object.fromEntries([...block.matchAll(/--([a-z0-9-]+): (#[0-9a-f]{6});/g)].map((m) => [m[1], m[2]]));
const darkAt = CSS.indexOf("@media (prefers-color-scheme: dark)");
const LOOKS = [
  { name: "light", css: tokens(CSS.slice(0, darkAt)), chart: LIGHT_CHART },
  { name: "dark", css: tokens(CSS.slice(darkAt, CSS.indexOf("html {", darkAt))), chart: DARK_CHART },
];

type Triple = [number, number, number];
const linear = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as Triple;
const luminance = (hex: string) => { const [r, g, b] = linear(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const times = (m: number[][], v: Triple) => m.map((row) => row.reduce((n, k, i) => n + k * v[i], 0)) as Triple;

/** Machado, Oliveira and Fernandes 2009, severity 1.0, from the authors' page. */
const VISION: Record<string, number[][]> = {
  typical: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
function lab(hex: string, vision: number[][]): Triple {
  const rgb = times(vision, linear(hex)).map((c) => Math.min(1, Math.max(0, c))) as Triple;
  const xyz = times([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.072175], [0.0193339, 0.119192, 0.9503041]], rgb);
  const [x, y, z] = xyz.map((v, i) => v / [0.95047, 1, 1.08883][i]).map((v) => (v > (6 / 29) ** 3 ? Math.cbrt(v) : v / (3 * (6 / 29) ** 2) + 4 / 29));
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

describe.each(LOOKS)("the $name look", ({ css, chart }) => {
  const backgrounds = ["canvas", "surface", "sunken", "chip", "note", "danger-bg"];
  it.each(["text", "text-2", "muted", "headline-light", "accent", "danger"])("%s is at least 4.5 to 1 on every background", (text) => {
    for (const b of backgrounds) expect(ratio(css[text], css[b]), `${text} on ${b}`).toBeGreaterThanOrEqual(4.5);
  });
  it("the pill text is readable at rest and on hover, and control edges are at least 3 to 1", () => {
    for (const b of ["pill", "pill-hover"]) expect(ratio(css["on-pill"], css[b])).toBeGreaterThanOrEqual(4.5);
    for (const b of ["canvas", "surface"]) expect(ratio(css.control, css[b])).toBeGreaterThanOrEqual(3);
  });
  it("uses no pure white or pure black background", () => {
    for (const b of backgrounds) expect(css[b]).not.toMatch(/^#(ffffff|000000)$/);
  });
  it("the chart colors match the stylesheet, and marks and text stand out from the page", () => {
    expect(chart.palette).toEqual([1, 2, 3, 4].map((n) => css[`series-${n}`]));
    expect([chart.text, chart.line, chart.fill]).toEqual([css["text-2"], css.line, css.surface]);
    for (const c of chart.palette) for (const b of ["canvas", "surface"]) expect(ratio(c, css[b]), `${c} on ${b}`).toBeGreaterThanOrEqual(3);
  });
  it.each(Object.keys(VISION))("the four series stay apart for %s vision", (v) => {
    const labs = chart.palette.map((c) => lab(c, VISION[v]));
    for (let i = 0; i < 4; i++) for (let j = 0; j < i; j++) expect(Math.hypot(...labs[i].map((n, k) => n - labs[j][k]))).toBeGreaterThan(10);
  });
});

describe.each(LOOKS)("the bar colors in the $name look", ({ css, chart }) => {
  it("the neutral mark and the accent are at least 3 to 1 on the canvas and the surface", () => {
    for (const color of [chart.mark, chart.selected]) for (const b of ["canvas", "surface"]) expect(ratio(color, css[b]), `${color} on ${b}`).toBeGreaterThanOrEqual(3);
  });
  it("the chart text is at least 4.5 to 1 on the canvas and the surface", () => {
    for (const b of ["canvas", "surface"]) expect(ratio(chart.text, css[b]), b).toBeGreaterThanOrEqual(4.5);
  });
  it("the stylesheet tokens and the chart theme agree, and the selected color is the app accent", () => {
    expect(chart.mark).toBe(css.mark);
    expect(chart.selected).toBe(css["mark-selected"]);
    expect(chart.selected).toBe(css.accent);
  });
  it.each(Object.keys(VISION))("the mark and the selected color stay apart for %s vision", (v) => {
    expect(Math.hypot(...lab(chart.mark, VISION[v]).map((n, k) => n - lab(chart.selected, VISION[v])[k]))).toBeGreaterThan(10);
  });
  it("a bar is the neutral mark unless picked, and a picked bar is the accent, and nothing is faded", () => {
    expect(barItem(chart, false)).toEqual({ color: chart.mark });
    expect(barItem(chart, true)).toEqual({ color: chart.selected });
    expect(barEmphasis(chart)).toEqual({ itemStyle: { color: chart.selected } });
    expect(JSON.stringify([barItem(chart, false), barItem(chart, true)])).not.toContain("opacity");
  });
  it("the mark is quiet: far less colorful than any of the four series colors", () => {
    const chroma = (hex: string) => Math.hypot(...lab(hex, VISION.typical).slice(1));
    for (const c of chart.palette) expect(chroma(chart.mark)).toBeLessThan(chroma(c) / 2);
  });
});

describe("the bar builders", () => {
  const journeys = readFileSync("src/app/journeys/page.tsx", "utf8");
  const pipeline = readFileSync("src/app/pipeline/page.tsx", "utf8");
  const section = (src: string, name: string) => src.slice(src.indexOf(`function ${name}`), src.indexOf(`
}
`, src.indexOf(`function ${name}`)));
  it.each([
    [journeys, "barOption"],
    [pipeline, "dwellOption"],
    [pipeline, "stalledOption"],
    [pipeline, "snapshotOption"],
  ])("%#: %s uses the roles, never a series color or a fade", (src, name) => {
    const body = section(src, name);
    expect(body.length).toBeGreaterThan(200);
    expect(body).toContain("barItem");
    expect(body).toContain("barEmphasis");
    expect(body).not.toMatch(/palette|opacity/);
  });
  it("draws the funnel bands with the roles: ink and the selected color from the tokens, never a series color or a fade", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const block = css.slice(css.indexOf(".fb-ink {"), css.indexOf(".fb-stage[aria-pressed"));
    expect(block).toContain("var(--text-2)");
    expect(block).toContain("var(--mark-selected)");
    expect(block).toContain("var(--mark)");
    expect(block).not.toMatch(/series|opacity/);
    expect(readFileSync("src/app/pipeline/funnel-bands.tsx", "utf8")).not.toMatch(/opacity|series/);
  });
  it("starts every bar axis at zero: no builder asks for a scale that skips it", () => {
    for (const src of [journeys, pipeline]) expect(src).not.toMatch(/scale: true/);
  });
});
