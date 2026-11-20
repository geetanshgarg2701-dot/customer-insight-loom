import type { AnchoredFlow } from "../charts/anchored";
import { MIN_GROUP, type Comparison } from "../charts/compare";
import type { Timing } from "../charts/timing";
import type { BehindStep } from "../charts/behind";
import type { ExampleJourney } from "../charts/replay";
import type { PipelineAt, StageRecords } from "../charts/pipeline-drill";
import type { TopPaths } from "../charts/crossfilter";
import type { CohortRow, DwellHistogram, FunnelStage, Outlook, PeriodComparison, Stalled } from "../charts/pipeline";
import type { StageCount, WhatIf } from "../charts/whatif";
import { PAIN_LABELS } from "../insights/comments";
import type { MentionRates } from "../insights/mentions";
import type { Why } from "../insights/why";
import type { ExitResult, WaitResult } from "../charts/rules";
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

export function explainAnchored(f: AnchoredFlow): Explanation[] {
  const out: Explanation[] = [
    {
      label: "Customers",
      value: `${formatCount(f.customers)} of ${formatCount(f.outOf)}`,
      how:
        `${formatCount(f.customers)} of the ${formatCount(f.outOf)} customers shown did ${f.anchor}. Each is counted once, from the first ` +
        `time they did it, even if they did it again later. Customers who never did it are left out of this view.`,
    },
  ];
  for (const c of f.columns) {
    if (c.offset === 0) continue;
    const named = c.events.map((e) => `${e.name} ${formatCount(e.count)}`).join(", ");
    const k = c.other.kinds;
    const grouped =
      k > 0
        ? ` ${k} other ${k === 1 ? "kind" : "kinds"} of ${k === 1 ? "event" : "events"}, ${formatCount(c.other.count)} customers, ${k === 1 ? "is" : "are"} grouped as Other events, so nothing is dropped.`
        : "";
    const side = c.offset > 0 ? "had a next event" : "had an earlier event";
    out.push({
      label: `Step ${c.offset > 0 ? "+" : ""}${c.offset}`,
      value: `${formatCount(c.present)} of ${formatCount(f.customers)} customers ${c.offset > 0 ? "went on" : "had one"}`,
      how:
        `${formatCount(c.present)} of ${formatCount(f.customers)} customers who did ${f.anchor} ${side} at this step. ` +
        `Most common: ${named || "none"}.${grouped}`,
    });
  }
  for (const n of f.nodes.filter((x) => x.kind === "ended")) {
    out.push({
      label: n.name,
      value: `${formatCount(n.count)} customers`,
      how: `${formatCount(n.count)} customers did nothing more after this step, so their path ends here. They are shown as a group of their own so each step's total still adds up. In real data, ended can also mean the customer has not acted yet, so read it with the conversion window in mind.`,
    });
  }
  return out;
}

export function explainComparison(c: Comparison): Explanation[] {
  const first = c.a.rates[0];
  return [
    {
      label: "Step rate",
      value: "people who went on, over people who reached the step before",
      how:
        `For example, in ${c.a.value}, ${formatCount(first.to)} of ${formatCount(first.from)} people who reached ` +
        `${first.step.split(" to ")[0]} went on to ${first.step.split(" to ")[1]}, which is ${formatPercent(first.rate ?? 0)}. ` +
        `Each step is measured only on people who reached the step before it.`,
    },
    {
      label: "Interval on a rate",
      value: "95 percent",
      how: "Each rate carries a Wilson score interval. It shows how much a rate could move from chance alone at this group size.",
    },
    {
      label: "Difference",
      value: "first group minus second group",
      how:
        "The gap between the groups carries a 95 percent Newcombe hybrid score interval, method 10 in Newcombe 1998, " +
        "built from the two Wilson intervals. Each interval is at 95 percent on its own and is not adjusted for the " +
        "other comparisons.",
    },
    {
      label: "Holm correction",
      value: "applied",
      how:
        "Each gap also gets a pooled two proportion z test p value, and the Holm step down procedure adjusts them across " +
        "every step compared. A gap is flagged only if its adjusted p value is at most 0.05. The plan uses Holm for fewer " +
        "than 10 comparisons because it keeps the chance of any false flag at 5 percent and loses little power.",
    },
    {
      label: "Comparisons made",
      value: String(c.comparisons),
      how: c.note,
    },
    {
      label: "Small groups",
      value: `${MIN_GROUP} people`,
      how:
        `A group with fewer than ${MIN_GROUP} people is shown muted with a warning, not hidden. ` +
        `${MIN_GROUP} is a judgment, not a rule from statistics.`,
    },
  ];
}

export function explainTiming(t: Timing): Explanation[] {
  const days = Math.round(t.windowHours / 24);
  const waiting = t.steps.reduce((n, s) => n + s.waiting, 0);
  const dropped = t.steps.reduce((n, s) => n + s.dropped, 0);
  return [
    {
      label: "Time between steps",
      value: "median and spread",
      how:
        "Measured only on people who reached both steps, from the moment they reached one to the moment they reached the " +
        "next. Cart to Purchase includes any Support detour in between. The median, quartiles and the 10th and 90th " +
        "percentiles are computed in SQL with linear interpolation.",
    },
    {
      label: "Still waiting",
      value: formatCount(waiting),
      how:
        `People who reached a step but not the next, whose ${days} day window, counted from entry into the journey, had ` +
        `not closed at the data cutoff of ${t.asOf.slice(0, 10)}. They are shown apart, not counted as dropped.`,
    },
    {
      label: "Dropped",
      value: formatCount(dropped),
      how: `People who reached a step but not the next, after their ${days} day window had closed.`,
    },
    {
      label: "Synthetic timing",
      value: "assumed",
      how:
        "The demo times come from assumptions written in the generator: entries over 28 days, gaps that are random with " +
        "a stated typical length and capped at 14 days, and new customers planted to take twice as long to buy.",
    },
  ];
}

export function explainBehind(b: BehindStep): Explanation[] {
  const flow =
    b.next === null || b.movedOn === null
      ? `${b.step} is the last step, so there is no next step to go on to.`
      : `${formatCount(b.movedOn)} went on to ${b.next} and ${formatCount(b.left ?? 0)} left at ${b.step}.`;
  return [
    {
      label: "People at this step",
      value: formatCount(b.reached),
      how: `Everyone in the current selection who reached ${b.step}. Of them, ${flow} Every person counts once.`,
    },
    {
      label: "Rate of going on",
      value: "with a 95 percent range",
      how: "For each group, the people who went on divided by the people who reached the step, with a Wilson score interval.",
    },
    {
      label: "Privacy",
      value: "aggregates only",
      how:
        `No individual person or path is shown, only groups by segment and channel. Groups under ${b.minGroup} people are ` +
        `merged into one row, and if that row is still under ${b.minGroup}, its numbers are hidden. The step totals still ` +
        `include everyone.`,
    },
  ];
}

export function explainReplay(j: ExampleJourney): Explanation[] {
  return [
    {
      label: "Synthetic customer",
      value: j.label,
      how: "The data holds no email or name. The label is a made up number, and the whole demo is generated, not real people.",
    },
    {
      label: "Privacy",
      value: "groups of at least " + String(j.minGroup),
      how:
        `A single path is shown only when at least ${j.minGroup} people match the selection and the outcome. ` +
        `${formatCount(j.groupSize)} match now. Under that, no path is shown at all. With real data, individual paths ` +
        `would also be limited to authorized users.`,
    },
    {
      label: "Times",
      value: "UTC",
      how:
        "Every time is stored and shown in UTC. Since entry counts from the first event. Since the step before counts " +
        "from the event just above it, and a detour such as Search is shown in its place.",
    },
  ];
}

export function explainDesigned(
  stats: ReadonlyMap<string, { entered: number; completed: number; endedHere: number; share: number }>,
  notDesigned: readonly string[],
  timingLoaded: boolean,
): Explanation[] {
  const first = stats.get("Visit");
  return [
    {
      label: "Entered, went on, ended here",
      value: "from the real paths",
      how: first
        ? `${formatCount(first.entered)} customers reached Visit. ${formatCount(first.completed)} went on to another step and ` +
          `${formatCount(first.endedHere)} ended there. Each customer counts once per step, and entered is always went on plus ended here.`
        : "Each customer counts once per step, and entered is always went on plus ended here.",
    },
    {
      label: "Design check",
      value: notDesigned.length === 0 ? "complete" : `${notDesigned.length} missing`,
      how:
        notDesigned.length === 0
          ? "Every move customers made from one step to the next has a connection on the canvas, so the design describes the data."
          : `Customers made moves the design has no connection for: ${notDesigned.join(", ")}. The canvas does not show them.`,
    },
    {
      label: "Sketched connections",
      value: "not saved",
      how:
        "A connection you sketch is not saved and carries no customer numbers. If it would make a loop, it is drawn as a " +
        "dashed back edge and the page warns, so you can check that the loop is intended.",
    },
    {
      label: "Median to next",
      value: timingLoaded ? "main steps only" : "not loaded yet",
      how: "The median hours to the next step is measured for the four main steps. Detours have no time measured yet.",
    },
  ];
}

export function explainRecords(r: StageRecords, asOf: string): Explanation[] {
  return [
    {
      label: "Deals listed",
      value: formatCount(r.groupSize),
      how:
        r.which === "reached"
          ? `Every deal in the current selection that reached ${r.stage}, in a fixed order, a page at a time.`
          : `Every deal in the current selection still open in ${r.stage}, in a fixed order, a page at a time.`,
    },
    {
      label: "Days in stage",
      value: "elapsed days",
      how:
        `From entering ${r.stage} to entering the next stage, or to being marked lost, or to the data cutoff of ` +
        `${asOf.slice(0, 10)} if the deal is still open. Counted in elapsed time, so clock changes do not move it.`,
    },
    {
      label: "Privacy",
      value: `at least ${r.minGroup} deals`,
      how: `Each deal has only a made up number. Records are listed only when at least ${r.minGroup} deals match, so a list cannot pick out one account in a tiny group.`,
    },
  ];
}

export function explainSnapshot(s: PipelineAt): Explanation[] {
  const [o1, o2, o3] = s.open;
  return [
    {
      label: "Deals entered by then",
      value: formatCount(s.entered),
      how:
        `Every deal that had entered by ${s.at.slice(0, 10)} is counted once: ${formatCount(o1)} plus ${formatCount(o2)} ` +
        `plus ${formatCount(o3)} open, ${formatCount(s.won)} won and ${formatCount(s.lost)} lost make ${formatCount(s.entered)}.`,
    },
    {
      label: "Open in a stage",
      value: "on that date",
      how:
        "A deal counts in a stage from the moment it enters, until it enters the next stage or is marked lost, so a deal " +
        "is never in two stages at once.",
    },
    {
      label: "Won and lost",
      value: "by that date",
      how: "Won and lost are running totals: every deal won or marked lost on or before the date.",
    },
  ];
}

export function explainMentions(r: MentionRates): Explanation[] {
  const shown = r.groups.find((g) => !g.tooSmall);
  const top = shown?.pains.reduce((a, b) => (b.mentions > a.mentions ? b : a));
  const hidden = r.groups.filter((g) => g.tooSmall);
  return [
    {
      label: "Mention rate",
      value: "comments that mention a pain, over all comments in the group",
      how:
        shown && top
          ? `For example, ${formatCount(top.mentions)} of the ${formatCount(shown.comments)} comments in ${shown.value} were coded ` +
            `${PAIN_LABELS[top.pain]}, which is ${formatPercent(top.rate, 1)}. Each comment has one coded pain.`
          : "No group is large enough to show.",
    },
    {
      label: "Groups",
      value: "from what customers did",
      how:
        "Each comment is joined to its customer in the journeys table, and the group comes from that row, so a group is a fact " +
        "about behavior. A higher rate in one group is an association. It does not show that the pain caused the behavior.",
    },
    {
      label: "Range",
      value: "95 percent",
      how: "Each rate carries a Wilson score interval. It shows how much a rate could move from chance alone at this group size. Ranges are not adjusted for the many rates shown.",
    },
    {
      label: "Small groups",
      value: `${MIN_GROUP} comments`,
      how:
        hidden.length > 0
          ? `${hidden.map((g) => g.value).join(", ")} had fewer than ${MIN_GROUP} comments, so their numbers are hidden.`
          : `A group with fewer than ${MIN_GROUP} comments would have its numbers hidden. None is that small here.`,
    },
    {
      label: "Not linked",
      value: `${formatCount(r.unlinked)} comments`,
      how: "Comments whose customer is not in the journeys table cannot be grouped, so they are counted here and left out of the rates.",
    },
  ];
}

export function explainWhy(w: Why): Explanation[] {
  return [
    {
      label: "Themes",
      value: `${formatCount(w.commenters.left)} who left and ${formatCount(w.commenters.wentOn)} who went on wrote a comment`,
      how:
        `Among customers who reached ${w.step} and wrote a comment, the share raising each theme is compared between those who left ` +
        `at ${w.step} and those who went on. The comments come from 3,000 of the first 20,000 synthetic customers, the same ones as on ` +
        "the comments screen, so most customers here have no comment. Each comment has one coded theme.",
    },
    {
      label: "Segments",
      value: "each group against everyone else at the step",
      how: `For each segment and channel group, the share who left at ${w.step} is compared with the share among everyone else who reached it.`,
    },
    {
      label: "Comparisons",
      value: String(w.comparisons),
      how:
        `Each gap gets a pooled two proportion z test p value. Benjamini Hochberg adjusts all ${w.comparisons} together at a false ` +
        `discovery rate of ${w.q}, the method the plan chose for discovery scans. Only adjusted p values at or under ${w.q} are listed, ` +
        `and only gaps that go with more leaving. A side with fewer than ${MIN_GROUP} people is not compared. The ranges are 95 percent ` +
        "Newcombe intervals and are not adjusted.",
    },
    {
      label: "What it can say",
      value: "association",
      how:
        "A listed item goes with more people leaving here. It does not show that it made them leave. Themes and segments overlap, " +
        "so one listed item can be the same customers as another. Only a ledger test with a holdout can support a causal reading.",
    },
  ];
}

export function explainRules(wait: WaitResult, exit: ExitResult): Explanation[] {
  return [
    {
      label: `Wait of ${wait.days} ${wait.days === 1 ? "day" : "days"} after ${wait.step}`,
      value: `${n(wait.reached)} people reached ${wait.step}`,
      how:
        `Each person who reached ${wait.step} is in one of four groups: ${n(wait.within)} went on to ${wait.next} within ${wait.days} ` +
        `${wait.days === 1 ? "day" : "days"}, ${n(wait.later)} went on later, ${n(wait.stillWaiting)} have not and the wait was not over at the ` +
        `data cutoff, and ${n(wait.outlasted)} have not and the wait was over. Together that is ${n(wait.within + wait.later + wait.stillWaiting + wait.outlasted)}. ` +
        `A move exactly at the wait counts as within it. The time to ${wait.next} includes any detour in between.`,
    },
    {
      label: "Exit conditions",
      value: `${n(exit.total)} people`,
      how:
        `${n(exit.goal)} reached the goal, the last step. Of the rest, ${n(exit.inactive)} had no event for at least ${exit.inactiveDays} days ` +
        `before the data cutoff, so they count as having left, and ${n(exit.active)} had an event more recently and are still active. ` +
        `A last event exactly ${exit.inactiveDays} days before the cutoff counts as inactive. The threshold changes the number, which is why it is shown beside it. ` +
        "In the demo the cutoff is long after the last event, so a short threshold leaves almost nobody active.",
    },
    {
      label: "What these are",
      value: "designed rules",
      how: "The wait and the exit rule are designed on the canvas, and the numbers on them are counted from the data. A rule here does not send anything or change a journey. It shows how the data fits the rule.",
    },
  ];
}
