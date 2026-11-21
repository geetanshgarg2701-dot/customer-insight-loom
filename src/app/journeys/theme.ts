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
  fontFamily: string;
  fontSize: number;
};

/**
 * One color per group, the same on every screen. The palette has four colors, so a segment and a channel can share one,
 * and the group name is always printed next to its color, so color is never the only signal.
 */
export const GROUP_COLOR: Record<string, string> = {
  new: "#2f4a8a",
  returning: "#1f7a72",
  vip: "#b7791f",
  ads: "#b7791f",
  email: "#1f7a72",
  organic: "#a8243b",
};

export const CHART_THEME: ChartTheme = {
  // Indigo, teal, ochre and madder. Each is at least 3 to 1 against white, the floor for chart marks, WCAG 1.4.11.
  palette: ["#2f4a8a", "#1f7a72", "#b7791f", "#a8243b"],
  text: "#18203a",
  line: "#d6dbe6",
  fontFamily: "system-ui, 'Segoe UI Variable Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  fontSize: 13,
};
