"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "@/lib/app/motion";
import { loadEcharts, withMotion, type ChartOption } from "@/lib/charts/echarts";

type Params = { name?: string; dataType?: string; seriesIndex?: number; dataIndex?: number };

/** One mark in a chart: which series, and which item in it when the series has items. */
export type Hit = { seriesIndex: number; dataIndex?: number };

/**
 * One chart. It draws the option it is given and reports clicks. The data and the filtering live outside, so the
 * chart holds no state of its own. The buttons next to each chart are the keyboard and screen reader route.
 */
export function Chart({
  label,
  option,
  height,
  onSelect,
  onHover,
  highlight,
}: {
  label: string;
  option: ChartOption;
  height: number;
  onSelect?: (name: string, dataType: string | undefined) => void;
  /** Told which mark the pointer is on, and null when it leaves, so other charts can show the same thing. */
  onHover?: (hit: Hit | null) => void;
  /** A mark pointed at in another chart, shown here in the accent. */
  highlight?: Hit | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<import("echarts/core").ECharts | null>(null);
  // The system setting and the Reduce motion switch, followed live.
  const reduceMotion = useReducedMotion();
  const latest = useRef({ option, onSelect, onHover, highlight, reduceMotion });
  // Kept current after each render, so the click handler set up once always calls the newest callback.
  useEffect(() => {
    latest.current = { option, onSelect, onHover, highlight, reduceMotion };
  });

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | null = null;
    void loadEcharts().then((echarts) => {
      if (disposed || !host.current) return;
      const chart = echarts.init(host.current);
      instance.current = chart;
      chart.setOption(withMotion(latest.current.option, latest.current.reduceMotion));
      chart.on("click", (params) => {
        const p = params as Params;
        if (p.name) latest.current.onSelect?.(p.name, p.dataType);
      });
      chart.on("mouseover", (params) => {
        const p = params as Params;
        if (typeof p.seriesIndex === "number") latest.current.onHover?.({ seriesIndex: p.seriesIndex, dataIndex: p.dataIndex });
      });
      chart.on("globalout", () => latest.current.onHover?.(null));
      applyHighlight(chart, latest.current.highlight ?? null);
      observer = new ResizeObserver(() => chart.resize());
      observer.observe(host.current);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      instance.current?.dispose();
      instance.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = instance.current;
    if (!chart) return;
    chart.setOption(withMotion(option, reduceMotion), { notMerge: true });
    // The new option is drawn on the next frame, so the highlight is applied then, on the drawn marks.
    const frame = requestAnimationFrame(() => applyHighlight(chart, highlight ?? null));
    return () => cancelAnimationFrame(frame);
  }, [option, reduceMotion, highlight]);

  // ECharts writes its own text description onto the chart element when the aria option is on, which is better than a
  // fixed label. The figure keeps the chart named on the page.
  return (
    <figure aria-label={label} data-motion={reduceMotion ? "off" : "on"} data-linked={highlight ? `${highlight.seriesIndex}:${highlight.dataIndex ?? ""}` : undefined} style={{ margin: 0 }}>
      <div ref={host} style={{ width: "100%", height }} />
    </figure>
  );
}

/** Shows one mark in its emphasis look, and clears any other. The look itself is set in the chart's option. */
function applyHighlight(chart: import("echarts/core").ECharts, hit: Hit | null) {
  chart.dispatchAction({ type: "downplay" });
  if (hit) chart.dispatchAction({ type: "highlight", seriesIndex: hit.seriesIndex, ...(hit.dataIndex === undefined ? {} : { dataIndex: hit.dataIndex }) });
}
