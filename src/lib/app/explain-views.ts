import type { TopPaths } from "../charts/crossfilter";
import type { CohortRow, DwellHistogram, FunnelStage, Outlook, PeriodComparison, Stalled } from "../charts/pipeline";
import type { StageCount, WhatIf } from "../charts/whatif";
import { formatCount, formatPercent, formatSignedPoints } from "./format";
import type { Explanation } from "./explain";

/**
 * "How was this worked out" for the journey and pipeline views. Like explain.ts, every sentence is built from the
 * values the numbers came from, so the words cannot drift from the figures, and nothing here computes a statistic.
 */

const n = (x: number) => formatCount(Math.round(x));
const days = (x: number) => `${x.toFixed(1)} days`;

export function explainFunnel(funnel: readonly FunnelStage[]): Explanation[] {
  return funnel.map((f, i) => {
    if (i === 0) {
      return {
        label: f.stage,
        value: `${formatCount(f.count)} deals`,
        how: `This is the whole group, everyone who matches the filters, and every deal starts here: ${formatCount(f.count)} deals.`,
      };
    }
    const prev = funnel[i - 1];
    return {
      label: f.stage,
      value: `${formatCount(f.count)} deals, ${formatPercent(f.conversion, 1)} of the stage before`,
      how:
        prev.count === 0
          ? `Since no deals reached ${prev.stage}, there is no share to work out.`
          : `${formatCount(f.count)} of the ${formatCount(prev.count)} deals that reached ${prev.stage} went on to reach ${f.stage}. ` +
            `${formatCount(f.count)} divided by ${formatCount(prev.count)} is ${formatPercent(f.conversion, 1)}.`,
    };
  });
}

export function explainDwell(h: DwellHistogram): Explanation[] {
  return [
    {
      label: "Deals that moved",
      value: formatCount(h.moved),
      how:
        `${formatCount(h.moved)} deals moved from ${h.from} to ${h.to}. Deals still waiting are not in it, so a slow ` +
        `stage looks faster than it really is.`,
    },
    {
      label: "Median",
      value: days(h.medianDays),
      how:
        `The middle value: half of these deals took less time than this and half took more. It is elapsed time from ` +
        `entering ${h.from} to entering ${h.to}, not calendar days.`,
    },
    {
      label: "90th percentile",
      value: days(h.p90Days),
      how: `About nine in ten of these deals took this long or less, so it shows how slow the slower deals are.`,
    },
  ];
}

export function explainStalled(
  stalled: readonly Stalled[],
  options: { thresholdDays: number; asOf: string },
): Explanation[] {
  const total = stalled.reduce((sum, s) => sum + s.count, 0);
  return [
    {
      label: "Stalled deals",
      value: formatCount(total),
      how:
        `Open deals, meaning not won and not lost, whose last stage entry was ${options.thresholdDays} days or more ` +
        `before the cutoff of ${options.asOf.slice(0, 10)}. A deal that someone has closed as lost is not stalled.`,
    },
    ...stalled.map((s) => ({
      label: `Stuck in ${s.stage}`,
      value: `${formatCount(s.count)} deals, median ${days(s.medianIdleDays)} idle`,
      how:
        `Idle time is elapsed time since the deal last entered a stage, counted up to the cutoff. Half of these deals ` +
        `have been idle for longer than ${days(s.medianIdleDays)}.`,
    })),
  ];
}

export function explainCohorts(rows: readonly CohortRow[], windowDays: number): Explanation[] {
  const out: Explanation[] = [];
  const first = rows.find((r) => r.mature);
  if (first) {
    out.push({
      label: `Example: ${first.cohort}`,
      value: `${formatPercent(first.qualifiedShare, 1)} reached Qualified`,
      how:
        `${formatCount(first.reachedQualified)} of ${formatCount(first.deals)} deals that entered in ${first.cohort} reached ` +
        `Qualified within ${windowDays} days of entering, which is ${formatPercent(first.qualifiedShare, 1)}. The Proposal ` +
        `and Won figures work the same way, each as a share of the deals that entered that month.`,
    });
  }
  const young = rows.filter((r) => !r.mature);
  if (young.length > 0) {
    out.push({
      label: "Still maturing",
      value: `${young.length} month${young.length === 1 ? "" : "s"}`,
      how:
        `${young.map((r) => r.cohort).join(", ")} ${young.length === 1 ? "has" : "have"} not had the whole window of ` +
        `${windowDays} days yet, because the newest deals entered less than ${windowDays} days before the cutoff. They are ` +
        `shown, but should not be compared with older months.`,
    });
  }
  return out;
}

export function explainPeriods(c: PeriodComparison): Explanation[] {
  const rows = c.rows.map((r) => ({
    label: r.stage,
    value: formatSignedPoints(r.difference, 1),
    how:
      `Earlier: ${formatCount(r.earlier.reached)} of ${formatCount(c.earlier.deals)} deals reached ${r.stage} within ` +
      `${c.windowDays} days, ${formatPercent(r.earlier.share, 1)}. Later: ${formatCount(r.later.reached)} of ` +
      `${formatCount(c.later.deals)} deals did, ${formatPercent(r.later.share, 1)}. The difference is the later share minus ` +
      `the earlier share. The 95 percent interval, from the Newcombe hybrid score method, runs from ` +
      `${formatSignedPoints(r.interval.low, 1)} to ${formatSignedPoints(r.interval.high, 1)}. ` +
      (r.significant
        ? "It excludes zero, so the two periods differ clearly. It does not say why."
        : "It includes zero, so these data cannot tell the two periods apart."),
  }));
  return [
    ...rows,
    {
      label: "Comparable",
      value: c.comparable ? "yes" : "no",
      how: c.comparable
        ? `Both periods have had the whole ${c.windowDays} day window, so the shares are fair to compare.`
        : `At least one period has deals that have not had the whole ${c.windowDays} day window yet, so the difference should not be read as a trend.`,
    },
  ];
}

export function explainPaths(r: TopPaths): Explanation[] {
  const rows = r.paths.map((p) => ({
    label: p.path,
    value: `${formatCount(p.count)} customers, ${formatPercent(p.share, 1)}`,
    how:
      `${formatCount(p.count)} of ${formatCount(r.total)} customers took exactly this route, detours included. ` +
      `${formatCount(p.count)} divided by ${formatCount(r.total)} is ${formatPercent(p.share, 1)}.`,
  }));
  if (r.other.paths > 0) {
    rows.push({
      label: "Other paths",
      value: `${formatCount(r.other.count)} customers in ${r.other.paths} routes`,
      how:
        `Each of these ${r.other.paths} routes was used by fewer than ${formatPercent(r.minShare, 0)} of customers. They are ` +
        `merged into one group, so the totals still add up to all ${formatCount(r.total)} customers.`,
    });
  }
  return rows;
}

export function explainWhatIf(s: WhatIf, stages: readonly StageCount[]): Explanation[] {
  const i = stages.findIndex((st, k) => k < stages.length - 1 && `${st.stage} to ${stages[k + 1].stage}` === s.step);
  const last = s.counts[s.counts.length - 1];
  const extra = Math.round(s.extraAtEnd);
  const out: Explanation[] = [];
  if (i >= 0) {
    out.push({
      label: s.step,
      value: `${formatPercent(s.currentRate, 1)} now, ${formatPercent(s.newRate, 1)} after`,
      how:
        `${n(stages[i + 1].count)} of ${n(stages[i].count)} people who reached ${stages[i].stage} went on to reach ` +
        `${stages[i + 1].stage}, which is ${formatPercent(s.currentRate, 1)}. The what if moves that to ${formatPercent(s.newRate, 1)}.`,
    });
  }
  const chain: string[] = [];
  for (let k = i + 1; k < s.counts.length - 1; k++) {
    const rate = stages[k].count === 0 ? 0 : stages[k + 1].count / stages[k].count;
    chain.push(
      `${n(s.counts[k].count)} people reach ${s.counts[k].stage}, and ${formatPercent(rate, 1)} of people there reach ` +
        `${s.counts[k + 1].stage}, so ${n(s.counts[k + 1].count)}.`,
    );
  }
  out.push({
    label: `Carried to ${last.stage}`,
    value: `${n(last.count)} people, ${Math.abs(extra).toLocaleString("en-US")} ${extra >= 0 ? "more" : "fewer"}`,
    how: `${chain.length > 0 ? chain.join(" ") + " " : "There are no later steps, so the change applies at the end. "}${s.note}`,
  });
  return out;
}

export function explainOutlook(o: Outlook): Explanation[] {
  const rows: Explanation[] = o.stages.map((s) => ({
    label: s.stage,
    value: `${n(s.expected)} expected wins`,
    how:
      s.resolved === 0
        ? `No deal that reached ${s.stage} has been won or lost yet, so there is no rate to apply.`
        : `${formatCount(s.won)} of the ${formatCount(s.resolved)} deals that reached ${s.stage} and have since been won or lost ` +
          `were won, which is ${formatPercent(s.rate, 1)}. ${formatCount(s.active)} active deals are at ${s.stage} now, so ` +
          `${formatCount(s.active)} times ${formatPercent(s.rate, 1)} is about ${n(s.expected)}. The 95 percent range for the rate, ` +
          `${formatPercent(s.rateLow, 1)} to ${formatPercent(s.rateHigh, 1)}, gives ${n(s.low)} to ${n(s.high)}.`,
  }));
  rows.push(
    {
      label: "Expected wins in total",
      value: `${n(o.totals.expected)}, range ${n(o.totals.low)} to ${n(o.totals.high)}`,
      how:
        `The sum of the stages above, from ${formatCount(o.totals.active)} active deals. The range comes from not knowing ` +
        `the win rates exactly, using the interval on each rate.`,
    },
    {
      label: "Spread from chance",
      value: `about ${Math.round(o.totals.chanceSpread)} either way`,
      how:
        `Each deal either wins or does not, so the real count varies by chance even with the rates exactly right. About 95 ` +
        `times in 100 it would fall within about ${Math.round(o.totals.chanceSpread)} of the expected number. This is a ` +
        `different kind of uncertainty from the range above.`,
    },
    {
      label: "Stalled deals left out",
      value: formatCount(o.totals.stalled),
      how:
        `${formatCount(o.totals.stalled)} open deals have not moved for ${o.thresholdDays} days or more. They are left out ` +
        `because a deal that has been quiet this long is much less likely to win than the average for its stage. See the ` +
        `stalled deals section.`,
    },
    {
      label: "What it assumes",
      value: "a planning aid",
      how:
        `It assumes that deals now behave like deals did before, and that the active deals are typical of their stage. It ` +
        `is a planning aid, not a forecast, and it says how many deals may be won, not when.`,
    },
  );
  return rows;
}
