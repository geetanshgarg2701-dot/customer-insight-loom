"use client";

import { useSyncExternalStore } from "react";

/**
 * The chart colors and fonts. ECharts draws to a canvas and cannot read CSS, so these mirror the tokens in globals.css, once for
 * the light look and once for the dark look. Change both places together. System fonts only.
 *
 * Two roles for bars: a muted neutral mark for every bar, and one accent, the same as the app accent, for the bar a person has
 * selected or is pointing at. The four series colors below are kept for charts that must tell groups apart.
 *
 * Four series at most. They come from the Okabe and Ito palette, darkened or lightened until each is at least 3 to 1 on the page.
 * theme.test.ts holds that, and that they stay apart under simulated color blindness.
 */

export type ChartTheme = {
  /** Series colors, in order. Only for charts that must tell groups apart. */
  palette: string[];
  /** The neutral color of a bar that is not selected. Quiet, and still at least 3 to 1 on the page. */
  mark: string;
  /** The one accent, for the selected or hovered bar. It is the app accent. */
  selected: string;
  /** The color of text on the chart. */
  text: string;
  /** The color of axis lines and grid lines. */
  line: string;
  /** The fill of a node or a box drawn on a chart. */
  fill: string;
  /**
   * One color per group, the same on every screen. A segment and a channel can share one, and the group name is always printed
   * next to its color, so color is never the only signal.
   */
  groups: Record<string, string>;
  fontFamily: string;
  fontSize: number;
};

const FONT = "system-ui, 'Segoe UI Variable Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

function theme(palette: [string, string, string, string], mark: string, selected: string, text: string, line: string, fill: string): ChartTheme {
  const [blue, orange, green, purple] = palette;
  return {
    palette,
    mark,
    selected,
    text,
    line,
    fill,
    groups: { new: blue, returning: green, vip: orange, ads: orange, email: green, organic: purple },
    fontFamily: FONT,
    fontSize: 13,
  };
}

export const LIGHT_CHART = theme(["#0072b2", "#c4510a", "#007a5a", "#a64b87"], "#7d838c", "#1d5e47", "#3e434b", "#d3d6db", "#f5f5f6");
export const DARK_CHART = theme(["#56b4e9", "#e69f00", "#2eb38c", "#d08ab5"], "#7b828b", "#7fd1b4", "#c9cdd2", "#2a2f34", "#16191c");

/** The same theme as CSS variables, for drawings made of page elements, which follow the look by themselves. */
export const CSS_CHART = theme(
  ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"],
  "var(--mark)",
  "var(--mark-selected)",
  "var(--text)",
  "var(--line)",
  "var(--surface)",
);

/**
 * How one bar is colored. Every bar is the neutral mark and the picked ones are the accent. A bar that is not picked is never
 * faded, because a faded mark falls below 3 to 1 on the page. Pointing at any bar turns it the accent.
 */
export function barItem(theme: ChartTheme, picked: boolean) {
  return { color: picked ? theme.selected : theme.mark };
}

/** The look of a bar under the pointer. */
export function barEmphasis(theme: ChartTheme) {
  return { itemStyle: { color: theme.selected } };
}

const DARK = "(prefers-color-scheme: dark)";

function subscribe(callback: () => void): () => void {
  const query = window.matchMedia(DARK);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

/** The chart colors for the look in use, following the system setting live. */
export function useChartTheme(): ChartTheme {
  const dark = useSyncExternalStore(subscribe, () => window.matchMedia(DARK).matches, () => false);
  return dark ? DARK_CHART : LIGHT_CHART;
}
