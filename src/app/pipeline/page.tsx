"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PIPELINE_DIMENSIONS, type Count, type PipelineDimension, type PipelineSelection } from "@/lib/charts/pipeline";
import type { CohortRow, DwellHistogram, FunnelStage, PeriodComparison, Stalled } from "@/lib/charts/pipeline";
import type { ChartOption } from "@/lib/charts/echarts";
import { PIPELINE_STAGES } from "@/lib/demo/pipeline";
import { formatPercent, formatSignedPoints } from "@/lib/app/format";
import { createBrowserPipelineBoard, type PipelineBoard } from "@/lib/duckdb/client";
import { CHART_THEME, type ChartTheme } from "../journeys/theme";
import { Chart } from "../journeys/chart";
import { Nav } from "../nav";

const TITLES: Record<PipelineDimension, string> = {
  segment: "Segment",
  source: "Source",
  stage: "Furthest stage",
  status: "Status",
};
const ROWS = 100_000;
const THRESHOLDS = [14, 30, 60] as const;
const STAGE_STEPS = [0, 1, 2] as const;
const WINDOWS = [30, 60, 90] as const;
const STATUS_ORDER = ["open", "won", "lost"];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

const base = (theme: ChartTheme): Pick<ChartOption, "aria" | "color" | "textStyle" | "tooltip"> => ({
  aria: { enabled: true },
  color: theme.palette,
  textStyle: { color: theme.text, fontFamily: theme.fontFamily, fontSize: theme.fontSize },
  tooltip: { trigger: "item" },
});

function funnelOption(funnel: FunnelStage[], selected: string[], theme: ChartTheme): ChartOption {
  return {
    ...base(theme),
    grid: { left: 90, right: 24, top: 8, bottom: 24 },
    xAxis: { type: "value", splitLine: { lineStyle: { color: theme.line } }, axisLabel: { color: theme.text } },
    yAxis: {
      type: "category",
      inverse: true,
      data: funnel.map((f) => f.stage),
      axisLine: { lineStyle: { color: theme.line } },
      axisLabel: { color: theme.text },
    },
    series: [
      {
        type: "bar",
        data: funnel.map((f) => ({
          value: f.count,
          name: f.stage,
          itemStyle: { opacity: selected.length === 0 || selected.includes(f.stage) ? 1 : 0.35 },
        })),
      },
    ],
  };
}

function dwellOption(h: DwellHistogram, theme: ChartTheme): ChartOption {
  const label = (from: number, i: number) => (i === h.bins.length - 1 && from >= 60 ? `${from}+` : `${from} to ${from + h.binDays}`);
  return {
    ...base(theme),
    grid: { left: 60, right: 16, top: 16, bottom: 52 },
    xAxis: {
      type: "category",
      name: "Days in stage",
      nameLocation: "middle",
      nameGap: 32,
      data: h.bins.map((b, i) => label(b.fromDay, i)),
      axisLine: { lineStyle: { color: theme.line } },
      axisLabel: { color: theme.text, interval: "auto" },
    },
    yAxis: { type: "value", splitLine: { lineStyle: { color: theme.line } }, axisLabel: { color: theme.text } },
    series: [{ type: "bar", data: h.bins.map((b) => b.count) }],
  };
}

function stalledOption(stalled: Stalled[], theme: ChartTheme): ChartOption {
  return {
    ...base(theme),
    grid: { left: 60, right: 16, top: 16, bottom: 28 },
    xAxis: {
      type: "category",
      data: stalled.map((s) => s.stage),
      axisLine: { lineStyle: { color: theme.line } },
      axisLabel: { color: theme.text },
    },
    yAxis: { type: "value", splitLine: { lineStyle: { color: theme.line } }, axisLabel: { color: theme.text } },
    series: [{ type: "bar", data: stalled.map((s) => s.count) }],
  };
}

const days = (n: number) => `${n.toFixed(1)} days`;
const dateOf = (iso: string) => iso.slice(0, 10);

export default function PipelinePage() {
  const board = useRef<PipelineBoard | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<PipelineSelection>({});
  const [stageStep, setStageStep] = useState<(typeof STAGE_STEPS)[number]>(2);
  const [threshold, setThreshold] = useState<(typeof THRESHOLDS)[number]>(30);
  const [counts, setCounts] = useState<Partial<Record<PipelineDimension, Count[]>>>({});
  const [funnel, setFunnel] = useState<FunnelStage[]>([]);
  const [dwell, setDwell] = useState<DwellHistogram | null>(null);
  const [stalled, setStalled] = useState<Stalled[]>([]);
  const [cohortWindow, setCohortWindow] = useState<(typeof WINDOWS)[number]>(60);
  const [cohorts, setCohorts] = useState<CohortRow[]>([]);
  const [periods, setPeriods] = useState<PeriodComparison | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const refresh = useCallback(async (next: PipelineSelection, step: number, days: number, windowDays: number) => {
    const b = board.current;
    if (!b) return;
    const started = performance.now();
    const [byDimension, f, d, s, c, p] = await Promise.all([
      Promise.all(PIPELINE_DIMENSIONS.map((dim) => b.counts(dim, next))),
      b.funnel(next),
      b.dwell(step, next),
      b.stalled(days, next),
      b.cohorts(windowDays, next),
      b.periods(windowDays, next),
    ]);
    setCounts(Object.fromEntries(PIPELINE_DIMENSIONS.map((dim, i) => [dim, byDimension[i]])));
    setFunnel(f);
    setDwell(d);
    setStalled(s);
    setCohorts(c);
    setPeriods(p);
    setElapsed(Math.round(performance.now() - started));
  }, []);

  async function onLoad() {
    setBusy(true);
    setError(null);
    try {
      board.current = await createBrowserPipelineBoard(ROWS);
      setLoaded(true);
      await refresh({}, stageStep, threshold, cohortWindow);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function run(next: PipelineSelection, step = stageStep, days = threshold, windowDays = cohortWindow) {
    try {
      await refresh(next, step, days, windowDays);
    } catch (e) {
      setError(messageOf(e));
    }
  }

  async function toggle(dimension: PipelineDimension, value: string) {
    const current = selection[dimension] ?? [];
    const values = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    const next = { ...selection, [dimension]: values };
    setSelection(next);
    await run(next);
  }

  async function pickStep(step: (typeof STAGE_STEPS)[number]) {
    setStageStep(step);
    await run(selection, step);
  }

  async function pickThreshold(value: (typeof THRESHOLDS)[number]) {
    setThreshold(value);
    await run(selection, stageStep, value);
  }

  async function pickWindow(value: (typeof WINDOWS)[number]) {
    setCohortWindow(value);
    await run(selection, stageStep, threshold, value);
  }

  async function clearAll() {
    setSelection({});
    await run({});
  }

  useEffect(() => {
    return () => {
      void board.current?.close();
      board.current = null;
    };
  }, []);

  const anySelected = PIPELINE_DIMENSIONS.some((d) => (selection[d] ?? []).length > 0);
  const shown = funnel[0]?.count ?? 0;
  const stalledTotal = stalled.reduce((n, s) => n + s.count, 0);

  return (
    <main>
      <Nav />
      <h1>Pipeline</h1>
      <p>
        Synthetic data only, so no real customer is shown. This view shows where deals wait and how long they sit. A
        click on a bar, or a button under it, filters everything else. Everything runs in this browser.
      </p>

      {!loaded && (
        <p>
          <button type="button" disabled={busy} onClick={() => void onLoad()}>
            Load synthetic pipeline
          </button>{" "}
          {busy && "Loading 100,000 synthetic deals"}
        </p>
      )}
      {error && <p role="alert">{error}</p>}

      {loaded && (
        <>
          <p>
            Showing {shown.toLocaleString("en-US")} of {ROWS.toLocaleString("en-US")} deals. Cutoff is 1 November 2026,
            the demo date. {elapsed !== null && <span>Updated in {elapsed} ms.</span>}{" "}
            <button type="button" disabled={!anySelected} onClick={() => void clearAll()}>
              Clear selection
            </button>
          </p>

          <section aria-labelledby="h-filters">
            <h2 id="h-filters">Filters</h2>
            {PIPELINE_DIMENSIONS.map((d) => {
              const list = counts[d] ?? [];
              const selected = selection[d] ?? [];
              const order: string[] | null = d === "stage" ? [...PIPELINE_STAGES] : d === "status" ? STATUS_ORDER : null;
              const sorted = order ? [...list].sort((a, b) => order.indexOf(a.value) - order.indexOf(b.value)) : list;
              return (
                <p key={d} role="group" aria-label={`Filter by ${TITLES[d].toLowerCase()}`}>
                  {TITLES[d]}:{" "}
                  {sorted.map((c) => (
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
              );
            })}
          </section>

          <section aria-labelledby="h-funnel">
            <h2 id="h-funnel">Stage funnel</h2>
            <p>How many deals reached each stage, and the share of the stage before that made it.</p>
            <Chart
              label="Deals that reached each stage"
              option={funnelOption(funnel, selection.stage ?? [], CHART_THEME)}
              height={200}
              onSelect={(name) => void toggle("stage", name)}
            />
            <table aria-label="Stage funnel">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Deals</th>
                  <th>Share of the stage before</th>
                </tr>
              </thead>
              <tbody>
                {funnel.map((f) => (
                  <tr key={f.stage}>
                    <td>{f.stage}</td>
                    <td>{f.count.toLocaleString("en-US")}</td>
                    <td>{formatPercent(f.conversion, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section aria-labelledby="h-dwell">
            <h2 id="h-dwell">Time in stage</h2>
            <p>
              Days a deal spent in a stage before moving on. Deals still waiting are not in it, so the real wait is
              longer than shown for slow stages.
            </p>
            <p role="group" aria-label="Choose a stage">
              {STAGE_STEPS.map((i) => (
                <button key={i} type="button" aria-pressed={stageStep === i} onClick={() => void pickStep(i)}>
                  {PIPELINE_STAGES[i]} to {PIPELINE_STAGES[i + 1]}
                </button>
              ))}
            </p>
            {dwell && (
              <>
                <Chart
                  label={`Days from ${dwell.from} to ${dwell.to}, deals per range`}
                  option={dwellOption(dwell, CHART_THEME)}
                  height={240}
                />
                <p>
                  {dwell.moved.toLocaleString("en-US")} deals moved from {dwell.from} to {dwell.to}. Median {days(dwell.medianDays)}.
                  Nine in ten took {days(dwell.p90Days)} or less.
                </p>
              </>
            )}
          </section>

          <section aria-labelledby="h-stalled">
            <h2 id="h-stalled">Stalled deals</h2>
            <p>
              Open deals with no movement for at least this long, by the stage they are stuck in. A deal that someone
              has closed as lost is not stalled, so it is not counted here.
            </p>
            <p role="group" aria-label="Stalled for at least">
              {THRESHOLDS.map((t) => (
                <button key={t} type="button" aria-pressed={threshold === t} onClick={() => void pickThreshold(t)}>
                  {t} days
                </button>
              ))}
            </p>
            <p>
              {stalledTotal.toLocaleString("en-US")} open deals have not moved for {threshold} days or more.
            </p>
            <Chart label="Stalled deals by stage" option={stalledOption(stalled, CHART_THEME)} height={200} />
            <table aria-label="Stalled deals">
              <thead>
                <tr>
                  <th>Stuck in</th>
                  <th>Deals</th>
                  <th>Median days idle</th>
                </tr>
              </thead>
              <tbody>
                {stalled.map((s) => (
                  <tr key={s.stage}>
                    <td>{s.stage}</td>
                    <td>{s.count.toLocaleString("en-US")}</td>
                    <td>{days(s.medianIdleDays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section aria-labelledby="h-cohorts">
            <h2 id="h-cohorts">Cohort ladder</h2>
            <p>
              Do newer deals reach each stage faster or slower? Each row is the deals that entered in one month, and each
              figure is the share that reached the stage within the window below, counting elapsed time from entry. A month
              whose newest deal has not had the whole window is marked as still maturing, because comparing it with older
              months would be unfair.
            </p>
            <p role="group" aria-label="Cohort window">
              {WINDOWS.map((w) => (
                <button key={w} type="button" aria-pressed={cohortWindow === w} onClick={() => void pickWindow(w)}>
                  Within {w} days
                </button>
              ))}
            </p>
            <table aria-label="Cohort ladder">
              <thead>
                <tr>
                  <th>Entered</th>
                  <th>Deals</th>
                  <th>Reached Qualified</th>
                  <th>Reached Proposal</th>
                  <th>Reached Won</th>
                  <th>Comparable</th>
                </tr>
              </thead>
              <tbody>
                {cohorts.map((c) => (
                  <tr key={c.cohort}>
                    <td>{c.cohort}</td>
                    <td>{c.deals.toLocaleString("en-US")}</td>
                    <td>{formatPercent(c.qualifiedShare, 1)}</td>
                    <td>{formatPercent(c.proposalShare, 1)}</td>
                    <td>{formatPercent(c.wonShare, 1)}</td>
                    <td>{c.mature ? "yes" : "still maturing"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section aria-labelledby="h-periods">
            <h2 id="h-periods">Period comparison</h2>
            <p>
              Do deals that entered recently reach each stage more or less often than those before? It compares the latest
              13 weeks of deals that have had the whole window with the 13 weeks before, using the window chosen above and
              counting elapsed time from entry. The newest deals are left out on purpose, because a deal that has not had
              the whole window yet would make the later period look worse than it is.
            </p>
            {periods && (
              <>
                <p>
                  Earlier: entered {dateOf(periods.earlier.from)} to {dateOf(periods.earlier.to)}, {periods.earlier.deals.toLocaleString("en-US")} deals.
                  Later: entered {dateOf(periods.later.from)} to {dateOf(periods.later.to)}, {periods.later.deals.toLocaleString("en-US")} deals.
                  Within {periods.windowDays} days of entering.
                </p>
                {!periods.comparable && (
                  <p role="alert">
                    One of these periods has deals that have not had the whole window yet, so the difference below should
                    not be read as a trend.
                  </p>
                )}
                <table aria-label="Period comparison">
                  <thead>
                    <tr>
                      <th>Reached</th>
                      <th>Earlier</th>
                      <th>Later</th>
                      <th>Difference</th>
                      <th>95 percent interval</th>
                      <th>Clear difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periods.rows.map((r) => (
                      <tr key={r.stage}>
                        <td>{r.stage}</td>
                        <td>{formatPercent(r.earlier.share, 1)}</td>
                        <td>{formatPercent(r.later.share, 1)}</td>
                        <td>{formatSignedPoints(r.difference, 1)}</td>
                        <td>
                          {formatSignedPoints(r.interval.low, 1)} to {formatSignedPoints(r.interval.high, 1)}
                        </td>
                        <td>{r.significant ? "yes" : "no, inconclusive"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p>
                  A clear difference says the two periods differ, not why. Something else may have changed at the same time,
                  such as the mix of deals or how they were counted. {periods.method}
                </p>
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}
