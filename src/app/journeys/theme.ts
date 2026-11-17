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

export const CHART_THEME: ChartTheme = {
  palette: ["#8a3b12", "#b88a5a", "#5b6b4a", "#3f5a6b"],
  text: "#1f1d1a",
  line: "#cfc7b8",
  fontFamily: "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
  fontSize: 13,
};
