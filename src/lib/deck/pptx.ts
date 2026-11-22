/**
 * Turns a deck model into a .pptx. PptxGenJS is imported only when a deck is made, so it never loads on an ordinary
 * visit. Charts are native PowerPoint charts, so they stay editable. Nothing here reads a file or the network.
 */
import type { DeckModel, DeckSlide } from "./deck";

// The app's look, in the form PowerPoint reads. Calibri comes with Office on Windows and Mac, so the deck looks the same
// wherever it is opened, which the app's own system fonts could not promise. The colours match globals.css.
const FONT = "Calibri";
const INK = "18203A";
const ACCENT = "A8243B";
const MUTED = "586079";
const LINE = "D6DBE6";
const SURFACE = "FFFFFF";

type Pres = import("pptxgenjs").default;
type Slide = ReturnType<Pres["addSlide"]>;

function addTitle(slide: Slide, text: string): void {
  slide.addText(text, { x: 0.6, y: 0.35, w: 12.1, h: 0.9, fontFace: FONT, fontSize: 28, bold: true, color: INK, fit: "shrink" });
  slide.addShape("line", { x: 0.6, y: 1.3, w: 12.1, h: 0, line: { color: LINE, width: 1 } });
}

function addLines(slide: Slide, lines: string[], box: { x: number; y: number; w: number; h: number }): void {
  slide.addText(
    lines.map((text) => ({ text, options: { bullet: { indent: 18 }, breakLine: true, paraSpaceAfter: 8 } })),
    { ...box, fontFace: FONT, fontSize: 16, color: INK, valign: "top", fit: "shrink" },
  );
}

function addTable(slide: Slide, table: NonNullable<DeckSlide["table"]>, box: { x: number; y: number; w: number }): void {
  const cell = (text: string, header: boolean) => ({
    text,
    options: { fontFace: FONT, fontSize: header ? 14 : 13, bold: header, color: header ? SURFACE : INK, fill: { color: header ? ACCENT : SURFACE } },
  });
  slide.addTable([table.header.map((h) => cell(h, true)), ...table.rows.map((r) => r.map((c) => cell(c, false)))], {
    ...box,
    border: { type: "solid", color: LINE, pt: 1 },
    valign: "top",
    margin: [4, 6, 4, 6],
  });
}

export async function renderDeck(deck: DeckModel): Promise<Uint8Array> {
  const mod = await import("pptxgenjs");
  const pptx = new mod.default();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = deck.slides[0]?.title ?? "Decision deck";
  pptx.company = "Customer Insight Loom";

  for (const s of deck.slides) {
    const slide = pptx.addSlide();
    slide.background = { color: SURFACE };
    if (s.kind === "title") {
      slide.addText(s.title, { x: 0.8, y: 1.8, w: 11.7, h: 1.8, fontFace: FONT, fontSize: 38, bold: true, color: INK, valign: "bottom", fit: "shrink" });
      slide.addShape("line", { x: 0.8, y: 3.75, w: 3, h: 0, line: { color: ACCENT, width: 3 } });
      slide.addText((s.lines ?? []).join("\n"), { x: 0.8, y: 4.0, w: 11.7, h: 1.6, fontFace: FONT, fontSize: 18, color: MUTED, valign: "top" });
      continue;
    }
    addTitle(slide, s.title);
    let y = 1.55;
    if (s.kind === "result") {
      if (s.table) addTable(slide, s.table, { x: 0.6, y, w: 6.2 });
      if (s.chart) {
        slide.addChart(
          "bar",
          [{ name: s.chart.title, labels: s.chart.labels, values: s.chart.values }],
          {
            x: 7.1,
            y,
            w: 5.6,
            h: 3.2,
            barDir: "col",
            chartColors: [ACCENT],
            showTitle: true,
            title: s.chart.title,
            titleFontFace: FONT,
            titleFontSize: 14,
            catAxisLabelFontFace: FONT,
            valAxisLabelFontFace: FONT,
            showValue: true,
            valAxisMinVal: 0,
            showLegend: false,
          },
        );
      }
      if (s.lines) addLines(slide, s.lines, { x: 0.6, y: 4.9, w: 12.1, h: 2.3 });
      continue;
    }
    if (s.kind === "chain" && s.lines) {
      slide.addText(s.lines[0], { x: 0.6, y, w: 12.1, h: 0.4, fontFace: FONT, fontSize: 14, italic: true, color: MUTED });
      y += 0.55;
    } else if (s.lines && s.table) {
      addLines(slide, s.lines, { x: 0.6, y, w: 12.1, h: 1 });
      y += 1.1;
    }
    if (s.table) addTable(slide, s.table, { x: 0.6, y, w: 12.1 });
    else if (s.lines) addLines(slide, s.lines, { x: 0.6, y, w: 12.1, h: 5.5 });
  }
  const out = await pptx.write({ outputType: "uint8array" });
  return out as Uint8Array;
}
