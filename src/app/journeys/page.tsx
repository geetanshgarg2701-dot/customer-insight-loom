"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JOURNEY_DIMENSIONS, type Count, type JourneyDimension, type SankeyEdge, type Selection } from "@/lib/charts/crossfilter";
import type { ChartOption } from "@/lib/charts/echarts";
import { createBrowserJourneyBoard, type JourneyBoard } from "@/lib/duckdb/client";
import { Nav } from "../nav";
import { Chart } from "./chart";
import { CHART_THEME, type ChartTheme } from "./theme";

const TITLES: Record<JourneyDimension, string> = {
  channel: "Channel",
  segment: "Segment",
  reached: "Furthest step reached",
};

const ROWS = 100_000;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function barOption(counts: Count[], selected: string[], theme: ChartTheme): ChartOption {
  return {
    aria: { enabled: true },
    color: theme.palette,
    textStyle: { color: theme.text, fontFamily: theme.fontFamily, fontSize: theme.fontSize },
    tooltip: { trigger: "item" },
    grid: { left: 60, right: 16, top: 16, bottom: 28 },
    xAxis: {
      type: "category",
      data: counts.map((c) => c.value),
      axisLine: { lineStyle: { color: theme.line } },
      axisLabel: { color: theme.text },
    },
    yAxis: { type: "value", splitLine: { lineStyle: { color: theme.line } }, axisLabel: { color: theme.text } },
    series: [
      {
        type: "bar",
        data: counts.map((c) => ({
          value: c.count,
          name: c.value,
          itemStyle: { opacity: selected.length === 0 || selected.includes(c.value) ? 1 : 0.35 },
        })),
      },
    ],
  };
}

/** The column a node sits in, read from its name. Drop off nodes sit in the column they leave. */
function depthOf(name: string): number {
  const step = /^(\d)\. /.exec(name);
  if (step) return Number(step[1]) - 1;
  const dropped = /^Dropped after (\d)\. /.exec(name);
  return dropped ? Number(dropped[1]) : 0;
}

function sankeyOption(edges: SankeyEdge[], theme: ChartTheme): ChartOption {
  const names = [...new Set(edges.flatMap((e) => [e.source, e.target]))];
  return {
    aria: { enabled: true },
    color: theme.palette,
    textStyle: { color: theme.text, fontFamily: theme.fontFamily, fontSize: theme.fontSize },
    tooltip: { trigger: "item" },
    series: [
      {
        type: "sankey",
        left: 8,
        right: 180,
        top: 8,
        bottom: 8,
        draggable: false,
        data: names.map((name) => ({ name, depth: depthOf(name) })),
        links: edges.map((e) => ({ source: e.source, target: e.target, value: e.value })),
        // ECharts outlines labels by default, which smears them on a dark background. The text colour carries it.
        label: { color: theme.text, textBorderWidth: 0, fontFamily: theme.fontFamily, fontSize: theme.fontSize },
        lineStyle: { color: "gradient", opacity: 0.4 },
      },
    ],
  };
}

export default function JourneysPage() {
  const board = useRef<JourneyBoard | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>({});
  const [counts, setCounts] = useState<Partial<Record<JourneyDimension, Count[]>>>({});
  const [edges, setEdges] = useState<SankeyEdge[]>([]);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const refresh = useCallback(async (next: Selection) => {
    const b = board.current;
    if (!b) return;
    const started = performance.now();
    const [byDimension, flow] = await Promise.all([
      Promise.all(JOURNEY_DIMENSIONS.map((d) => b.counts(d, next))),
      b.flow(next),
    ]);
    setCounts(Object.fromEntries(JOURNEY_DIMENSIONS.map((d, i) => [d, byDimension[i]])));
    setEdges(flow);
    setElapsed(Math.round(performance.now() - started));
  }, []);

  async function onLoad() {
    setBusy(true);
    setError(null);
    try {
      board.current = await createBrowserJourneyBoard(ROWS);
      setLoaded(true);
      await refresh({});
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(dimension: JourneyDimension, value: string) {
    const current = selection[dimension] ?? [];
    const nextValues = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    const next: Selection = { ...selection, [dimension]: nextValues };
    setSelection(next);
    try {
      await refresh(next);
    } catch (e) {
      setError(messageOf(e));
    }
  }

  async function clearAll() {
    setSelection({});
    await refresh({});
  }

  useEffect(() => {
    return () => {
      void board.current?.close();
      board.current = null;
    };
  }, []);

  // Customers who match every selection. The furthest step chart is not selected by default, so its counts add up to this.
  const shown = useMemo(() => {
    const first = edges.filter((e) => e.source.startsWith("1. ")).reduce((n, e) => n + e.value, 0);
    return first;
  }, [edges]);
  const anySelected = JOURNEY_DIMENSIONS.some((d) => (selection[d] ?? []).length > 0);

  return (
    <main>
      <Nav />
      <h1>Journeys</h1>
      <p>
        Synthetic data only, so no real customer is shown. A click on a bar, or a button under it, filters the other
        charts and the flow. Everything runs in this browser.
      </p>

      {!loaded && (
        <p>
          <button type="button" disabled={busy} onClick={() => void onLoad()}>
            Load synthetic journeys
          </button>{" "}
          {busy && "Loading 100,000 synthetic customers"}
        </p>
      )}
      {error && <p role="alert">{error}</p>}

      {loaded && (
        <>
          <p>
            Showing {shown.toLocaleString("en-US")} of {ROWS.toLocaleString("en-US")} customers.{" "}
            {elapsed !== null && <span>Updated in {elapsed} ms.</span>}{" "}
            <button type="button" disabled={!anySelected} onClick={() => void clearAll()}>
              Clear selection
            </button>
          </p>

          {JOURNEY_DIMENSIONS.map((d) => {
            const list = counts[d] ?? [];
            const selected = selection[d] ?? [];
            return (
              <section key={d} aria-labelledby={`h-${d}`}>
                <h2 id={`h-${d}`}>{TITLES[d]}</h2>
                <Chart
                  label={`${TITLES[d]}, customers per value`}
                  option={barOption(list, selected, CHART_THEME)}
                  height={180}
                  onSelect={(name) => void toggle(d, name)}
                />
                <p role="group" aria-label={`Filter by ${TITLES[d].toLowerCase()}`}>
                  {list.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      aria-pressed={selected.includes(c.value)}
                      onClick={() => void toggle(d, c.value)}
                    >
                      {c.value}, {c.count.toLocaleString("en-US")}
                    </button>
                  ))}
                </p>
              </section>
            );
          })}

          <section aria-labelledby="h-flow">
            <h2 id="h-flow">Flow between steps</h2>
            <Chart label="Flow of customers between steps, with drop off" option={sankeyOption(edges, CHART_THEME)} height={320} />
            <table className="flow" aria-label="Flow between steps">
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th>Customers</th>
                </tr>
              </thead>
              <tbody>
                {edges.map((e) => (
                  <tr key={`${e.source}>${e.target}`}>
                    <td>{e.source}</td>
                    <td>{e.target}</td>
                    <td>{e.value.toLocaleString("en-US")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}
