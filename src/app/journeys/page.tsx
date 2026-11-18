"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JOURNEY_DIMENSIONS, type Count, type JourneyDimension, type SankeyEdge, type Selection, type TopPaths } from "@/lib/charts/crossfilter";
import { anchorChoices, anchoredFlow, type AnchoredFlow, type PathCount } from "@/lib/charts/anchored";
import { stageCountsFromFlow, whatIf } from "@/lib/charts/whatif";
import { formatPercent } from "@/lib/app/format";
import type { ChartOption } from "@/lib/charts/echarts";
import { createBrowserJourneyBoard, type JourneyBoard } from "@/lib/duckdb/client";
import { explainAnchored, explainPaths, explainWhatIf } from "@/lib/app/explain-views";
import { Explain } from "../explain";
import { Nav } from "../nav";
import { Chart } from "./chart";
import { CHART_THEME, type ChartTheme } from "./theme";

const TITLES: Record<JourneyDimension, string> = {
  channel: "Channel",
  segment: "Segment",
  reached: "Furthest step reached",
};

const ROWS = 100_000;
const RARITY = [0.01, 0.02, 0.05] as const;
const CHANGES = [-10, 5, 10, 20] as const;
const STEPS = [0, 1, 2, 3] as const;
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

  const choices = useMemo(() => anchorChoices(allPaths), [allPaths]);
  const around = useMemo(() => anchoredFlow(allPaths, { anchor, before, after, topN }), [allPaths, anchor, before, after, topN]);

  async function onLoad() {
    setBusy(true);
    setError(null);
    try {
      board.current = await createBrowserJourneyBoard(ROWS);
      setLoaded(true);
      await refresh({}, rarity);
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
      await refresh(next, rarity);
    } catch (e) {
      setError(messageOf(e));
    }
  }

  async function clearAll() {
    setSelection({});
    await refresh({}, rarity);
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
