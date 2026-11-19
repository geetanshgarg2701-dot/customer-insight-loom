"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JOURNEY_DIMENSIONS, type Count, type JourneyDimension, type SankeyEdge, type Selection, type TopPaths } from "@/lib/charts/crossfilter";
import { anchorChoices, anchoredFlow, type AnchoredFlow, type PathCount } from "@/lib/charts/anchored";
import { COMPARE_DIMENSIONS, differenceSentence, type CompareDimension, type Comparison } from "@/lib/charts/compare";
import { formatDuration, timingSentence, type Timing } from "@/lib/charts/timing";
import type { BehindStep } from "@/lib/charts/behind";
import type { ExampleJourney } from "@/lib/charts/replay";
import { JOURNEY_STEPS } from "@/lib/demo/journeys";
import { CHANNELS, SEGMENTS } from "@/lib/demo/journeys";
import { stageCountsFromFlow, whatIf } from "@/lib/charts/whatif";
import { formatPercent, formatSignedPoints } from "@/lib/app/format";
import type { ChartOption } from "@/lib/charts/echarts";
import { createBrowserJourneyBoard, type JourneyBoard } from "@/lib/duckdb/client";
import { createCycle, runWhileCurrent } from "@/lib/app/latest";
import { explainAnchored, explainBehind, explainComparison, explainReplay, explainPaths, explainTiming, explainWhatIf } from "@/lib/app/explain-views";
import { Explain } from "../explain";
import { Nav } from "../nav";
import { Chart } from "./chart";
import { JourneyCanvas } from "./canvas";
import { CHART_THEME, GROUP_COLOR, type ChartTheme } from "./theme";

const TITLES: Record<JourneyDimension, string> = {
  channel: "Channel",
  segment: "Segment",
  reached: "Furthest step reached",
};

const ROWS = 100_000;
const RARITY = [0.01, 0.02, 0.05] as const;
const CHANGES = [-10, 5, 10, 20] as const;
const STEPS = [0, 1, 2, 3] as const;
const WINDOWS = [168, 720] as const;
const REPLAY_OUTCOMES = [
  { reached: "Purchase", label: "Bought" },
  { reached: "Cart", label: "Left at Cart" },
  { reached: "Product", label: "Left at Product" },
  { reached: "Visit", label: "Left at Visit" },
] as const;
const TOP_N = [3, 5, Infinity] as const;

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

/**
 * Two panels in one chart, on the same scale from 0 to 100 percent, so the bars can be compared by eye. Each bar is
 * labeled with its value. A group under the minimum size is drawn muted.
 */
function comparisonOption(c: Comparison, theme: ChartTheme): ChartOption {
  const groups = [c.a, c.b];
  const steps = c.a.rates.map((r) => r.step);
  return {
    aria: { enabled: true },
    textStyle: { color: theme.text, fontFamily: theme.fontFamily, fontSize: theme.fontSize },
    tooltip: { trigger: "item" },
    title: groups.map((g, i) => ({
      text: `${g.value}, ${g.entered.toLocaleString("en-US")} people`,
      left: i === 0 ? "7%" : "57%",
      top: 0,
      textStyle: { color: theme.text, fontFamily: theme.fontFamily, fontSize: theme.fontSize, fontWeight: "normal" },
    })),
    grid: [
      { left: "7%", width: "38%", top: 34, bottom: 56 },
      { left: "57%", width: "38%", top: 34, bottom: 56 },
    ],
    xAxis: groups.map((_, i) => ({
      type: "category" as const,
      gridIndex: i,
      data: steps,
      axisLine: { lineStyle: { color: theme.line } },
      axisLabel: { color: theme.text, interval: 0, width: 80, overflow: "break" as const },
    })),
    yAxis: groups.map((_, i) => ({
      type: "value" as const,
      gridIndex: i,
      min: 0,
      max: 1,
      axisLabel: { color: theme.text, formatter: (v: number) => `${Math.round(v * 100)}` },
      splitLine: { lineStyle: { color: theme.line } },
    })),
    series: groups.map((g, i) => ({
      type: "bar" as const,
      xAxisIndex: i,
      yAxisIndex: i,
      name: g.value,
      barWidth: "46%",
      label: {
        show: true,
        position: "top" as const,
        color: theme.text,
        fontFamily: theme.fontFamily,
        formatter: (p) => (typeof p.value === "number" ? `${(p.value * 100).toFixed(1)}` : ""),
      },
      data: g.rates.map((r) => ({
        value: r.rate,
        itemStyle: { color: GROUP_COLOR[g.value] ?? theme.palette[0], opacity: g.tooSmall ? 0.35 : 1 },
      })),
    })),
  };
}

/**
 * Time between steps as box plots on a log scale, because the gaps run from minutes to days. The box is the middle
 * half, the line inside is the median, and the whiskers reach the 10th and 90th percentiles.
 */
function timingOption(t: Timing, theme: ChartTheme): ChartOption {
  const shown = t.steps.filter((s) => s.medianHours !== null);
  return {
    aria: { enabled: true },
    textStyle: { color: theme.text, fontFamily: theme.fontFamily, fontSize: theme.fontSize },
    tooltip: { trigger: "item" },
    grid: { left: 64, right: 16, top: 24, bottom: 40 },
    xAxis: {
      type: "category",
      data: shown.map((s) => s.step),
      axisLine: { lineStyle: { color: theme.line } },
      axisLabel: { color: theme.text, interval: 0 },
    },
    yAxis: {
      type: "log",
      name: "hours, log scale",
      nameTextStyle: { color: theme.text },
      axisLabel: { color: theme.text },
      splitLine: { lineStyle: { color: theme.line } },
    },
    series: [
      {
        type: "boxplot",
        itemStyle: { color: "#efe6d6", borderColor: theme.palette[0] },
        data: shown.map((s) => [s.p10Hours!, s.p25Hours!, s.medianHours!, s.p75Hours!, s.p90Hours!]),
      },
    ],
  };
}

function anchoredOption(flow: AnchoredFlow, theme: ChartTheme): ChartOption {
  return {
    aria: { enabled: true },
    color: theme.palette,
    textStyle: { color: theme.text, fontFamily: theme.fontFamily, fontSize: theme.fontSize },
    tooltip: { trigger: "item" },
    series: [
      {
        type: "sankey",
        left: 8,
        right: 150,
        top: 8,
        bottom: 8,
        draggable: false,
        data: flow.nodes.map((n) => ({
          name: n.name,
          depth: n.depth,
          itemStyle: n.kind === "ended" || n.kind === "began" ? { color: theme.line } : undefined,
        })),
        links: flow.edges.map((e) => ({ source: e.source, target: e.target, value: e.value })),
        label: { color: theme.text, textBorderWidth: 0, fontFamily: theme.fontFamily, fontSize: theme.fontSize },
        lineStyle: { color: "gradient", opacity: 0.4 },
      },
    ],
  };
}

export default function JourneysPage() {
  const board = useRef<JourneyBoard | null>(null);
  const [cycle] = useState(createCycle);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>({});
  const [counts, setCounts] = useState<Partial<Record<JourneyDimension, Count[]>>>({});
  const [edges, setEdges] = useState<SankeyEdge[]>([]);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [rarity, setRarity] = useState<(typeof RARITY)[number]>(0.02);
  const [paths, setPaths] = useState<TopPaths | null>(null);
  const [allPaths, setAllPaths] = useState<PathCount[]>([]);
  const [anchor, setAnchor] = useState("Cart");
  const [before, setBefore] = useState<(typeof STEPS)[number]>(1);
  const [after, setAfter] = useState<(typeof STEPS)[number]>(2);
  const [topN, setTopN] = useState<(typeof TOP_N)[number]>(3);
  const [cmpDim, setCmpDim] = useState<CompareDimension>("segment");
  const [cmpA, setCmpA] = useState("new");
  const [cmpB, setCmpB] = useState("returning");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [windowHours, setWindowHours] = useState<(typeof WINDOWS)[number]>(168);
  const [timing, setTiming] = useState<Timing | null>(null);
  const [behindIndex, setBehindIndex] = useState(2);
  const [behind, setBehind] = useState<BehindStep | null>(null);
  const [replayReached, setReplayReached] = useState("Purchase");
  const [replayOffset, setReplayOffset] = useState(0);
  const [replay, setReplay] = useState<ExampleJourney | null>(null);
  const [eventIndex, setEventIndex] = useState(0);
  const [whatStep, setWhatStep] = useState(1);
  const [whatPoints, setWhatPoints] = useState<(typeof CHANGES)[number]>(10);

  const refresh = useCallback(async (next: Selection, minShare: number) => {
    const b = board.current;
    if (!b) return;
    const started = performance.now();
    const [byDimension, flow, topped, distinct] = await Promise.all([
      Promise.all(JOURNEY_DIMENSIONS.map((d) => b.counts(d, next))),
      b.flow(next),
      b.paths(minShare, next),
      b.pathCounts(next),
    ]);
    setAllPaths(distinct);
    setCounts(Object.fromEntries(JOURNEY_DIMENSIONS.map((d, i) => [d, byDimension[i]])));
    setEdges(flow);
    setPaths(topped);
    setElapsed(Math.round(performance.now() - started));
  }, []);

  const refreshComparison = useCallback(async (dim: CompareDimension, a: string, b: string, sel: Selection) => {
    const board_ = board.current;
    if (!board_) return;
    setComparison(a === b ? null : await board_.compare(dim, a, b, sel));
  }, []);

  const refreshTiming = useCallback(async (hours: number, sel: Selection) => {
    const board_ = board.current;
    if (!board_) return;
    setTiming(await board_.timing(hours, sel));
  }, []);

  const refreshBehind = useCallback(async (index: number, sel: Selection) => {
    const board_ = board.current;
    if (!board_) return;
    setBehind(await board_.behind(index, sel));
  }, []);

  const refreshReplay = useCallback(async (reached: string, offset: number, sel: Selection) => {
    const board_ = board.current;
    if (!board_) return;
    const next = await board_.replay(reached, offset, sel);
    setReplay(next);
    setEventIndex(Math.max(0, next.events.length - 1));
  }, []);

  async function pickReplay(reached: string, offset: number) {
    setReplayReached(reached);
    setReplayOffset(offset);
    try {
      await refreshReplay(reached, offset, selection);
    } catch (e) {
      setError(messageOf(e));
    }
  }

  async function pickBehind(index: number) {
    setBehindIndex(index);
    try {
      await refreshBehind(index, selection);
    } catch (e) {
      setError(messageOf(e));
    }
  }

  /** A click on a flow node opens the step it belongs to: "2. Product" and "Dropped after 2. Product" both mean step 2. */
  function pickFromFlow(name: string) {
    const m = /^(?:Dropped after )?(\d)\. /.exec(name);
    if (m) void pickBehind(Number(m[1]) - 1);
  }

  async function changeWindow(hours: (typeof WINDOWS)[number]) {
    setWindowHours(hours);
    try {
      await refreshTiming(hours, selection);
    } catch (e) {
      setError(messageOf(e));
    }
  }

  async function changeCompare(dim: CompareDimension, a: string, b: string) {
    setCmpDim(dim);
    setCmpA(a);
    setCmpB(b);
    try {
      await refreshComparison(dim, a, b, selection);
    } catch (e) {
      setError(messageOf(e));
    }
  }

  const choices = useMemo(() => anchorChoices(allPaths), [allPaths]);
  const around = useMemo(() => anchoredFlow(allPaths, { anchor, before, after, topN }), [allPaths, anchor, before, after, topN]);

  /** The lower sections, one after another, stopping as soon as a newer click has started its own cycle. */
  async function refreshLower(id: number, sel: Selection, replayAt: number) {
    await runWhileCurrent(cycle, id, [
      () => refreshComparison(cmpDim, cmpA, cmpB, sel),
      () => refreshTiming(windowHours, sel),
      () => refreshBehind(behindIndex, sel),
      () => refreshReplay(replayReached, replayAt, sel),
    ]);
  }

  async function onLoad() {
    setBusy(true);
    setError(null);
    try {
      board.current = await createBrowserJourneyBoard(ROWS);
      setLoaded(true);
      const id = cycle.start();
      await refresh({}, rarity);
      await refreshLower(id, {}, replayOffset);
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
    const id = cycle.start();
    try {
      await refresh(next, rarity);
      await refreshLower(id, next, 0);
      setReplayOffset(0);
    } catch (e) {
      setError(messageOf(e));
    }
  }

  async function clearAll() {
    setSelection({});
    const id = cycle.start();
    await refresh({}, rarity);
    await refreshLower(id, {}, 0);
    setReplayOffset(0);
  }

  async function pickRarity(value: (typeof RARITY)[number]) {
    setRarity(value);
    try {
      await refresh(selection, value);
    } catch (e) {
      setError(messageOf(e));
    }
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
  const stages = useMemo(() => stageCountsFromFlow(edges), [edges]);
  const scenario = useMemo(
    () => (stages.length >= 2 ? whatIf(stages, { fromStep: whatStep, points: whatPoints }) : null),
    [stages, whatStep, whatPoints],
  );
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

          <section aria-labelledby="h-designed">
            <h2 id="h-designed">Designed journey</h2>
            <p>
              The journey as it was designed, with the live numbers on every step and a count on every connection. Select
              a main step to open who is behind it. The two detours, Search and Support, are branches off the main steps.
              The numbers follow the filters above.
            </p>
            {allPaths.length > 0 && <JourneyCanvas paths={allPaths} timing={timing} onOpenStep={(i) => void pickBehind(i)} />}
          </section>

          <section aria-labelledby="h-flow">
            <h2 id="h-flow">Flow between steps</h2>
            <Chart label="Flow of customers between steps, with drop off" option={sankeyOption(edges, CHART_THEME)} height={320} onSelect={(name) => pickFromFlow(name)} />
            <p>Select a step or a drop off in the flow to see who is behind it, below.</p>
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

          <section aria-labelledby="h-behind">
            <h2 id="h-behind">Behind a step</h2>
            <p>
              Who reached a step, by segment and channel, and how many went on or left there. Only groups are shown,
              never a single person, and small groups are merged.
            </p>
            <p role="group" aria-label="Step to look behind">
              Step:{" "}
              {JOURNEY_STEPS.map((s, i) => (
                <button key={s} type="button" aria-pressed={behindIndex === i} onClick={() => void pickBehind(i)}>
                  {s}
                </button>
              ))}
            </p>
            {behind && (
              <div>
                <p>
                  {behind.reached.toLocaleString("en-US")} people reached {behind.step}.
                  {behind.next !== null && behind.movedOn !== null
                    ? ` ${behind.movedOn.toLocaleString("en-US")} went on to ${behind.next} and ${(behind.left ?? 0).toLocaleString("en-US")} left at ${behind.step}.`
                    : ` It is the last step, so nobody goes on from here.`}
                </p>
                <table aria-label="Behind a step">
                  <thead>
                    <tr>
                      <th scope="col">Group</th>
                      <th scope="col">Reached {behind.step}</th>
                      {behind.next !== null && <th scope="col">Went on to {behind.next}</th>}
                      {behind.next !== null && <th scope="col">Left at {behind.step}</th>}
                      {behind.next !== null && <th scope="col">Rate of going on, with range</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {behind.groups.map((g) => (
                      <tr key={g.label}>
                        <td>{g.label}</td>
                        <td>{g.reached === null ? "hidden" : g.reached.toLocaleString("en-US")}</td>
                        {behind.next !== null && <td>{g.movedOn === null ? "hidden" : g.movedOn.toLocaleString("en-US")}</td>}
                        {behind.next !== null && <td>{g.left === null ? "hidden" : g.left.toLocaleString("en-US")}</td>}
                        {behind.next !== null && (
                          <td>
                            {g.rate === null
                              ? "hidden"
                              : `${formatPercent(g.rate, 1)}, ${formatPercent(g.low ?? 0, 1)} to ${formatPercent(g.high ?? 0, 1)}`}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p>Groups with a lower rate go with more people leaving here. That is an association, not a cause.</p>
                <Explain summary="How who is behind a step was worked out" items={explainBehind(behind)} />
              </div>
            )}
          </section>

          <section aria-labelledby="h-compare">
            <h2 id="h-compare">Compare two groups</h2>
            <p>
              Two groups on the same journey, on the same scale. Each bar is the share of people who reached the step
              before and went on to this one, so every step is measured only on people who got that far. Results here
              are exploratory and show association, not cause.
            </p>
            <p role="group" aria-label="Compare by">
              Compare by:{" "}
              {COMPARE_DIMENSIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={cmpDim === d}
                  onClick={() => {
                    const list = d === "segment" ? SEGMENTS : CHANNELS;
                    void changeCompare(d, list[0], list[1]);
                  }}
                >
                  {d === "segment" ? "Segment" : "Channel"}
                </button>
              ))}
            </p>
            <p>
              <label>
                First group{" "}
                <select value={cmpA} onChange={(e) => void changeCompare(cmpDim, e.target.value, cmpB)}>
                  {(cmpDim === "segment" ? SEGMENTS : CHANNELS).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>{" "}
              <label>
                Second group{" "}
                <select value={cmpB} onChange={(e) => void changeCompare(cmpDim, cmpA, e.target.value)}>
                  {(cmpDim === "segment" ? SEGMENTS : CHANNELS).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </p>
            {cmpA === cmpB && <p role="alert">Choose two different groups to compare.</p>}
            {comparison && (
              <div>
                {[comparison.a, comparison.b]
                  .filter((g) => g.tooSmall)
                  .map((g) => (
                    <p key={g.value} role="alert">
                      {g.value} has only {g.entered.toLocaleString("en-US")} people, under the 30 person minimum, so its
                      numbers are shown muted and are not to be trusted.
                    </p>
                  ))}
                <Chart
                  label={`Share of people who went on at each step, ${comparison.a.value} and ${comparison.b.value}`}
                  option={comparisonOption(comparison, CHART_THEME)}
                  height={320}
                />
                <table aria-label="Compare two groups">
                  <thead>
                    <tr>
                      <th scope="col">Step</th>
                      <th scope="col">{comparison.a.value}</th>
                      <th scope="col">{comparison.b.value}</th>
                      <th scope="col">Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.a.rates.map((ra, i) => {
                      const rb = comparison.b.rates[i];
                      const d = comparison.differences.find((x) => x.step === ra.step);
                      const cell = (r: typeof ra) =>
                        r.rate === null
                          ? "nobody to measure"
                          : `${formatPercent(r.rate, 1)}, ${formatPercent(r.low ?? 0, 1)} to ${formatPercent(r.high ?? 0, 1)}, ${r.to.toLocaleString("en-US")} of ${r.from.toLocaleString("en-US")}`;
                      return (
                        <tr key={ra.step}>
                          <td>{ra.step}</td>
                          <td>{cell(ra)}</td>
                          <td>{cell(rb)}</td>
                          <td>
                            {d
                              ? `${formatSignedPoints(d.difference, 1)}, ${formatSignedPoints(d.low, 1)} to ${formatSignedPoints(d.high, 1)}${d.excludesZero ? ", interval excludes zero" : ", interval includes zero"}`
                              : "not measured"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <ul>
                  {comparison.differences.map((d) => (
                    <li key={d.step}>{differenceSentence(comparison, d)}</li>
                  ))}
                </ul>
                <p>{comparison.note}</p>
                <Explain summary="How this comparison was worked out" items={explainComparison(comparison)} />
              </div>
            )}
          </section>

          <section aria-labelledby="h-timing">
            <h2 id="h-timing">Time between steps</h2>
            <p>
              How long people took to move from one step to the next, as a spread and not only an average. People who
              reached a step and did not move on are split into still waiting, while their window is open, and dropped,
              once it has closed.
            </p>
            <p role="group" aria-label="Window from entry">
              Window from entry:{" "}
              {WINDOWS.map((h) => (
                <button key={h} type="button" aria-pressed={windowHours === h} onClick={() => void changeWindow(h)}>
                  {h / 24} days
                </button>
              ))}
            </p>
            {timing && (
              <div>
                <Chart label="Hours between steps, median, middle half and 10th to 90th percentile" option={timingOption(timing, CHART_THEME)} height={300} />
                <table aria-label="Time between steps">
                  <caption>
                    {timing.windowHours / 24} day window from entry, data cutoff {timing.asOf.slice(0, 10)}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Step</th>
                      <th scope="col">Moved on</th>
                      <th scope="col">Median</th>
                      <th scope="col">Middle half</th>
                      <th scope="col">10th to 90th</th>
                      <th scope="col">Still waiting</th>
                      <th scope="col">Dropped</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timing.steps.map((s) => (
                      <tr key={s.step}>
                        <td>{s.step}</td>
                        <td>{s.moved.toLocaleString("en-US")}</td>
                        <td>{s.medianHours === null ? "none" : formatDuration(s.medianHours)}</td>
                        <td>{s.p25Hours === null ? "none" : `${formatDuration(s.p25Hours)} to ${formatDuration(s.p75Hours!)}`}</td>
                        <td>{s.p10Hours === null ? "none" : `${formatDuration(s.p10Hours)} to ${formatDuration(s.p90Hours!)}`}</td>
                        <td>{s.waiting.toLocaleString("en-US")}</td>
                        <td>{s.dropped.toLocaleString("en-US")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ul>
                  {timing.steps.map((s) => (
                    <li key={s.step}>{timingSentence(s, timing.windowHours)}</li>
                  ))}
                </ul>
                <p>
                  The demo times are synthetic, from assumptions written in the generator. Every window in the demo has
                  closed by the cutoff, so nobody is still waiting here.
                </p>
                <Explain summary="How time between steps was worked out" items={explainTiming(timing)} />
              </div>
            )}
          </section>

          <section aria-labelledby="h-replay">
            <h2 id="h-replay">Replay one path</h2>
            <p>
              Step through one synthetic customer, event by event, with the time each step took. The customer has only a
              made up label, and a single path is shown only when at least 30 people match, so it cannot single anyone
              out.
            </p>
            <p role="group" aria-label="Customers who">
              Customers who:{" "}
              {REPLAY_OUTCOMES.map((o) => (
                <button key={o.reached} type="button" aria-pressed={replayReached === o.reached} onClick={() => void pickReplay(o.reached, 0)}>
                  {o.label}
                </button>
              ))}
            </p>
            {replay && replay.hidden && <p role="alert">{replay.label}.</p>}
            {replay && !replay.hidden && (
              <div>
                <p>
                  {replay.label}, {replay.segment} segment, {replay.channel} channel. Customer {replay.position} of{" "}
                  {replay.of.toLocaleString("en-US")} who match.{" "}
                  <button type="button" onClick={() => void pickReplay(replayReached, replayOffset + 1)}>
                    Show another customer
                  </button>
                </p>
                <p>
                  <button type="button" disabled={eventIndex <= 0} onClick={() => setEventIndex(Math.max(0, eventIndex - 1))}>
                    Previous event
                  </button>{" "}
                  <button type="button" disabled={eventIndex >= replay.events.length - 1} onClick={() => setEventIndex(Math.min(replay.events.length - 1, eventIndex + 1))}>
                    Next event
                  </button>{" "}
                  <button type="button" onClick={() => setEventIndex(0)}>
                    Replay from the start
                  </button>{" "}
                  <label>
                    Event shown{" "}
                    <input
                      type="range"
                      min={1}
                      max={replay.events.length}
                      value={eventIndex + 1}
                      onChange={(e) => setEventIndex(Number(e.target.value) - 1)}
                    />
                  </label>
                </p>
                <p aria-live="polite">
                  Event {eventIndex + 1} of {replay.events.length}: {replay.events[eventIndex].step},{" "}
                  {formatDuration(replay.events[eventIndex].hoursSinceEntry)} after entry
                  {replay.events[eventIndex].hoursSincePrevious === null
                    ? "."
                    : `, ${formatDuration(replay.events[eventIndex].hoursSincePrevious!)} after ${replay.events[eventIndex - 1].step}.`}
                </p>
                <table aria-label="Replay one path">
                  <thead>
                    <tr>
                      <th scope="col">Event</th>
                      <th scope="col">Step</th>
                      <th scope="col">UTC time</th>
                      <th scope="col">Since entry</th>
                      <th scope="col">Since the step before</th>
                    </tr>
                  </thead>
                  <tbody>
                    {replay.events.slice(0, eventIndex + 1).map((ev, i) => (
                      <tr key={`${i}-${ev.at}`}>
                        <td>{i + 1}</td>
                        <td>{ev.step}</td>
                        <td>{ev.at.replace("T", " ").slice(0, 16)} UTC</td>
                        <td>{formatDuration(ev.hoursSinceEntry)}</td>
                        <td>{ev.hoursSincePrevious === null ? "start" : formatDuration(ev.hoursSincePrevious)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Explain summary="How this replay was worked out" items={explainReplay(replay)} />
              </div>
            )}
          </section>

          <section aria-labelledby="h-around">
            <h2 id="h-around">Around one event</h2>
            <p>
              Pick an event to see what customers did just before and just after it. Each customer who did it is
              counted once, from the first time. The most common events at each step are named and the rest are
              grouped, so every step still adds up.
            </p>
            <p>
              <label>
                Event{" "}
                <select value={anchor} onChange={(e) => setAnchor(e.target.value)}>
                  {choices.map((c) => (
                    <option key={c.event} value={c.event}>
                      {c.event}, {c.customers.toLocaleString("en-US")} customers
                    </option>
                  ))}
                </select>
              </label>
            </p>
            <p role="group" aria-label="Steps before">
              Steps before:{" "}
              {STEPS.map((n) => (
                <button key={n} type="button" aria-pressed={before === n} onClick={() => setBefore(n)}>
                  {n}
                </button>
              ))}
            </p>
            <p role="group" aria-label="Steps after">
              Steps after:{" "}
              {STEPS.map((n) => (
                <button key={n} type="button" aria-pressed={after === n} onClick={() => setAfter(n)}>
                  {n}
                </button>
              ))}
            </p>
            <p role="group" aria-label="Events named per step">
              Events named per step:{" "}
              {TOP_N.map((n) => (
                <button key={String(n)} type="button" aria-pressed={topN === n} onClick={() => setTopN(n)}>
                  {Number.isFinite(n) ? n : "All"}
                </button>
              ))}
            </p>
            {around.customers === 0 ? (
              <p>No customer in the current selection did {anchor}.</p>
            ) : (
              <div>
                <p>
                  {around.customers.toLocaleString("en-US")} of {around.outOf.toLocaleString("en-US")} customers did{" "}
                  {anchor}.
                </p>
                <Chart label={`What customers did before and after ${anchor}`} option={anchoredOption(around, CHART_THEME)} height={340} />
                <table aria-label="Around one event">
                  <thead>
                    <tr>
                      <th scope="col">Step</th>
                      <th scope="col">Event</th>
                      <th scope="col">Customers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {around.columns.flatMap((c) => [
                      ...c.events.map((e) => (
                        <tr key={`${c.offset}|${e.name}`}>
                          <td>{c.offset === 0 ? "Anchor" : c.offset > 0 ? `+${c.offset}` : String(c.offset)}</td>
                          <td>{e.name}</td>
                          <td>{e.count.toLocaleString("en-US")}</td>
                        </tr>
                      )),
                      ...(c.other.kinds > 0
                        ? [
                            <tr key={`${c.offset}|other`}>
                              <td>{c.offset > 0 ? `+${c.offset}` : String(c.offset)}</td>
                              <td>Other events, {c.other.kinds} kinds</td>
                              <td>{c.other.count.toLocaleString("en-US")}</td>
                            </tr>,
                          ]
                        : []),
                    ])}
                    {around.nodes
                      .filter((n) => n.kind === "ended")
                      .map((n) => (
                        <tr key={n.name}>
                          <td colSpan={2}>{n.name}, path ends</td>
                          <td>{n.count.toLocaleString("en-US")}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                <Explain summary="How this view was worked out" items={explainAnchored(around)} />
              </div>
            )}
          </section>

          <section aria-labelledby="h-paths">
            <h2 id="h-paths">Top paths</h2>
            <p>
              The routes customers actually took, detours included, largest first. A path used by fewer than the share
              below is merged into one group instead of being listed, so the totals still add up to the flow above.
            </p>
            <p role="group" aria-label="Rarity threshold">
              {RARITY.map((r) => (
                <button key={r} type="button" aria-pressed={rarity === r} onClick={() => void pickRarity(r)}>
                  Merge paths under {formatPercent(r, 0)}
                </button>
              ))}
            </p>
            {paths && (
              <table aria-label="Top paths">
                <thead>
                  <tr>
                    <th>Path</th>
                    <th>Customers</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {paths.paths.map((p) => (
                    <tr key={p.path}>
                      <td>{p.path}</td>
                      <td>{p.count.toLocaleString("en-US")}</td>
                      <td>{formatPercent(p.share, 1)}</td>
                    </tr>
                  ))}
                  {paths.other.paths > 0 && (
                    <tr>
                      <td>
                        Other paths, {paths.other.paths} routes each under {formatPercent(paths.minShare, 0)}
                      </td>
                      <td>{paths.other.count.toLocaleString("en-US")}</td>
                      <td>{formatPercent(paths.other.share, 1)}</td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">All customers shown</th>
                    <td>{paths.total.toLocaleString("en-US")}</td>
                    <td>{formatPercent(1, 1)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
            {paths && <Explain summary="How top paths were worked out" items={explainPaths(paths)} />}
          </section>

          <section aria-labelledby="h-whatif">
            <h2 id="h-whatif">What if</h2>
            <p>If one step kept more of the people who reach it, how many more would reach the end?</p>
            <p role="group" aria-label="Step to change">
              {stages.slice(0, -1).map((s, i) => (
                <button key={s.stage} type="button" aria-pressed={whatStep === i} onClick={() => setWhatStep(i)}>
                  {s.stage} to {stages[i + 1].stage}
                </button>
              ))}
            </p>
            <p role="group" aria-label="Change in percentage points">
              {CHANGES.map((c) => (
                <button key={c} type="button" aria-pressed={whatPoints === c} onClick={() => setWhatPoints(c)}>
                  {c > 0 ? `+${c}` : c} points
                </button>
              ))}
            </p>
            {scenario && (
              <>
                <p>
                  {scenario.step} now keeps {formatPercent(scenario.currentRate, 1)} of the people who reach it. At{" "}
                  {formatPercent(scenario.newRate, 1)}, about {Math.round(Math.abs(scenario.extraAtEnd)).toLocaleString("en-US")}{" "}
                  {scenario.extraAtEnd >= 0 ? "more" : "fewer"} people would reach {stages[stages.length - 1].stage}, a change of{" "}
                  {formatPercent(scenario.extraShare, 1)}.
                </p>
                <p>{scenario.note}</p>
                <Explain summary="How the what if was worked out" items={explainWhatIf(scenario, stages)} />
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}
