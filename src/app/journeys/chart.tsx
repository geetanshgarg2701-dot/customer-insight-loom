"use client";

import { useEffect, useRef } from "react";
import { loadEcharts, type ChartOption } from "@/lib/charts/echarts";

type Params = { name?: string; dataType?: string };

/**
 * One chart. It draws the option it is given and reports clicks. The data and the filtering live outside, so the
 * chart holds no state of its own. The buttons next to each chart are the keyboard and screen reader route.
 */
export function Chart({
  label,
  option,
  height,
  onSelect,
}: {
  label: string;
  option: ChartOption;
  height: number;
  onSelect?: (name: string, dataType: string | undefined) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<import("echarts/core").ECharts | null>(null);
  const latest = useRef({ option, onSelect });
  // Kept current after each render, so the click handler set up once always calls the newest callback.
  useEffect(() => {
    latest.current = { option, onSelect };
  });

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | null = null;
    void loadEcharts().then((echarts) => {
      if (disposed || !host.current) return;
      const chart = echarts.init(host.current);
      instance.current = chart;
      chart.setOption(latest.current.option);
      chart.on("click", (params) => {
        const p = params as Params;
        if (p.name) latest.current.onSelect?.(p.name, p.dataType);
      });
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
    instance.current?.setOption(option, { notMerge: true });
  }, [option]);

  // ECharts writes its own text description onto the chart element when the aria option is on, which is better than a
  // fixed label. The figure keeps the chart named on the page.
  return (
    <figure aria-label={label} style={{ margin: 0 }}>
      <div ref={host} style={{ width: "100%", height }} />
    </figure>
  );
}
