/**
 * Three style directions to choose from, as tokens. The page styles come from styles.css, keyed by the same names.
 * ECharts draws to a canvas and cannot read CSS, so the chart colours and fonts live here as well. System fonts only,
 * so no font file is downloaded and nothing is added to the bundle. Contrast was checked for text on its background.
 */

export const STYLE_NAMES = ["editorial", "dense", "friendly"] as const;
export type StyleName = (typeof STYLE_NAMES)[number];

export type ChartTheme = {
  /** Series colours, in order. */
  palette: string[];
  /** The colour of text on the chart. */
  text: string;
  /** The colour of axis lines and grid lines. */
  line: string;
  fontFamily: string;
  fontSize: number;
};

export const STYLE_LABELS: Record<StyleName, { title: string; blurb: string }> = {
  editorial: { title: "Quiet editorial", blurb: "Warm paper, serif type, thin rules. Reads like a report." },
  dense: { title: "Dense analytics", blurb: "Dark panels, small type, numbers first. Built for scanning." },
  friendly: { title: "Friendly", blurb: "Soft cards, rounded buttons, one bright accent." },
};

export const CHART_THEMES: Record<StyleName, ChartTheme> = {
  editorial: {
    palette: ["#8a3b12", "#b88a5a", "#5b6b4a", "#3f5a6b"],
    text: "#1f1d1a",
    line: "#cfc7b8",
    fontFamily: "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
    fontSize: 13,
  },
  dense: {
    palette: ["#4cc2ff", "#2ee6a6", "#ffb84c", "#ff6b81"],
    text: "#d7dde5",
    line: "#2b3644",
    fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, Menlo, monospace",
    fontSize: 11,
  },
  friendly: {
    palette: ["#6d4aff", "#ff8a5c", "#2bb673", "#ffc83d"],
    text: "#2a2540",
    line: "#e4def7",
    fontFamily: "system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    fontSize: 14,
  },
};
