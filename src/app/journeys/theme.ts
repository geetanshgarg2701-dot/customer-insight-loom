/**
 * The chart colours and fonts for the quiet editorial style. ECharts draws to a canvas and cannot read CSS, so these
 * mirror the tokens in globals.css. System fonts only. Change both places together.
 */

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

/**
 * One color per group, the same on every screen. The palette has four colors, so a segment and a channel can share one,
 * and the group name is always printed next to its color, so color is never the only signal.
 */
export const GROUP_COLOR: Record<string, string> = {
  new: "#8a3b12",
  returning: "#3f5a6b",
  vip: "#5b6b4a",
  ads: "#b88a5a",
  email: "#3f5a6b",
  organic: "#5b6b4a",
};

export const CHART_THEME: ChartTheme = {
  palette: ["#8a3b12", "#b88a5a", "#5b6b4a", "#3f5a6b"],
  text: "#1f1d1a",
  line: "#cfc7b8",
  fontFamily: "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
  fontSize: 13,
};
