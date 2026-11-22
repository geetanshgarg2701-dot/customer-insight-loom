/**
 * The chart colours and fonts for the app look. ECharts draws to a canvas and cannot read CSS, so these
 * mirror the tokens in globals.css. System fonts only. Change both places together.
 */

export type ChartTheme = {
  /** Series colours, in order. */
  palette: string[];
  /** The colour of text on the chart. */
  text: string;
  /** The colour of axis lines and grid lines. */
  line: string;
  /** The fill of a node or a box drawn on a chart. */
  fill: string;
  fontFamily: string;
  fontSize: number;
};

/**
 * One color per group, the same on every screen. The palette has four colors, so a segment and a channel can share one,
 * and the group name is always printed next to its color, so color is never the only signal.
 */
export const GROUP_COLOR: Record<string, string> = {
  new: "#7aa7ff",
  returning: "#5fd3a8",
  vip: "#f2c14e",
  ads: "#f2c14e",
  email: "#5fd3a8",
  organic: "#ff8a9a",
};

export const CHART_THEME: ChartTheme = {
  // Mint, blue, gold and coral. Each is at least 3 to 1 against the near black cards, the floor for chart marks, WCAG 1.4.11.
  palette: ["#5fd3a8", "#7aa7ff", "#f2c14e", "#ff8a9a"],
  text: "#e8efec",
  line: "#2c3833",
  fill: "#0d1311",
  fontFamily: "system-ui, 'Segoe UI Variable Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  fontSize: 13,
};
