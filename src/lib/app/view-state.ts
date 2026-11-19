import { DESIGNED_JOURNEY } from "../charts/designed";
import { CHANNELS, JOURNEY_STEPS, SEGMENTS } from "../demo/journeys";
import { PIPELINE_SEGMENTS, PIPELINE_SOURCES, PIPELINE_STAGES } from "../demo/pipeline";

/**
 * Shareable views. A link holds a version and a handful of choices, filters and section settings, and nothing else:
 * never data, never a name. It is read-only, because opening it only sets the screen's choices on the synthetic data.
 *
 * A link is input from outside, so it is untrusted. Every value is checked against a fixed list or a fixed range before
 * it is used, anything else is ignored and reported, and the length is capped. No text from a link ever reaches a query
 * except as one of the fixed values below.
 */

export const MAX_LINK_LENGTH = 400;
const VERSION = "1";

type Result<T> = { view: Partial<T>; ignored: string[] };

function parse(text: string): { params: URLSearchParams } | { stop: string[] } {
  const raw = text.startsWith("#") ? text.slice(1) : text;
  if (raw === "") return { stop: [] };
  if (raw.length > MAX_LINK_LENGTH) return { stop: ["length"] };
  const params = new URLSearchParams(raw);
  if (params.get("v") !== VERSION) return { stop: ["v"] };
  return { params };
}

/** The listed values that appear in a comma separated parameter, once each, in the order given. */
function pickList(value: string, allowed: readonly string[]): { kept: string[]; dropped: boolean } {
  const kept: string[] = [];
  let dropped = false;
  for (const item of value.split(",")) {
    if (allowed.includes(item)) {
      if (!kept.includes(item)) kept.push(item);
    } else dropped = true;
  }
  return { kept, dropped };
}

function pickNumber<T extends number>(params: URLSearchParams, key: string, allowed: readonly T[], ignored: string[]): T | undefined {
  const raw = params.get(key);
  if (raw === null) return undefined;
  const n = /^\d{1,4}$/.test(raw) ? Number(raw) : NaN;
  if ((allowed as readonly number[]).includes(n)) return n as T;
  ignored.push(key);
  return undefined;
}

function pickWord<T extends string>(params: URLSearchParams, key: string, allowed: readonly T[], ignored: string[]): T | undefined {
  const raw = params.get(key);
  if (raw === null) return undefined;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  ignored.push(key);
  return undefined;
}

function selectionFrom(
  params: URLSearchParams,
  lists: Readonly<Record<string, readonly string[]>>,
  ignored: string[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [dim, allowed] of Object.entries(lists)) {
    const raw = params.get(`f.${dim}`);
    if (raw === null) continue;
    const { kept, dropped } = pickList(raw, allowed);
    if (dropped) ignored.push(`f.${dim}`);
    if (kept.length > 0) out[dim] = kept;
  }
  return out;
}

function selectionTo(selection: Readonly<Record<string, string[] | undefined>>, order: readonly string[]): string[] {
  return order.flatMap((dim) => {
    const values = selection[dim];
    return values && values.length > 0 ? [`f.${dim}=${values.join(",")}`] : [];
  });
}

// ---- journeys ----

export const JOURNEY_FILTERS = { channel: CHANNELS, segment: SEGMENTS, reached: JOURNEY_STEPS } as const;
const JOURNEY_EVENTS = DESIGNED_JOURNEY.nodes.map((n) => n.id);
const COUNTS = [0, 1, 2, 3] as const;
const COMPARE_LISTS = { segment: SEGMENTS, channel: CHANNELS } as const;

export type JourneyView = {
  selection: Partial<Record<"channel" | "segment" | "reached", string[]>>;
  compare: { dim: "segment" | "channel"; a: string; b: string };
  windowHours: 168 | 720;
  behindIndex: 0 | 1 | 2 | 3;
  replayReached: string;
  anchor: string;
  before: 0 | 1 | 2 | 3;
  after: 0 | 1 | 2 | 3;
  topN: 3 | 5 | typeof Infinity;
};

export function encodeJourneyView(v: JourneyView): string {
  const parts = [
    `v=${VERSION}`,
    ...selectionTo(v.selection, ["channel", "segment", "reached"]),
    `cmp=${v.compare.dim}.${v.compare.a}.${v.compare.b}`,
    `w=${v.windowHours}`,
    `b=${v.behindIndex}`,
    `r=${v.replayReached}`,
    `an=${v.anchor}`,
    `bf=${v.before}`,
    `af=${v.after}`,
    `tn=${Number.isFinite(v.topN) ? v.topN : "all"}`,
  ];
  return parts.join("&");
}

export function decodeJourneyView(text: string): Result<JourneyView> {
  const parsed = parse(text);
  if ("stop" in parsed) return { view: {}, ignored: parsed.stop };
  const { params } = parsed;
  const ignored: string[] = [];
  const view: Partial<JourneyView> = {};

  view.selection = selectionFrom(params, JOURNEY_FILTERS, ignored) as JourneyView["selection"];

  const cmp = params.get("cmp");
  if (cmp !== null) {
    const [dim, a, b, extra] = cmp.split(".");
    const list = dim === "segment" || dim === "channel" ? (COMPARE_LISTS[dim] as readonly string[]) : null;
    if (list && extra === undefined && a !== b && list.includes(a) && list.includes(b)) {
      view.compare = { dim: dim as "segment" | "channel", a, b };
    } else ignored.push("cmp");
  }

  const w = pickNumber(params, "w", [168, 720] as const, ignored);
  if (w !== undefined) view.windowHours = w;
  const b = pickNumber(params, "b", COUNTS, ignored);
  if (b !== undefined) view.behindIndex = b;
  const r = pickWord(params, "r", JOURNEY_STEPS, ignored);
  if (r !== undefined) view.replayReached = r;
  const an = pickWord(params, "an", JOURNEY_EVENTS, ignored);
  if (an !== undefined) view.anchor = an;
  const bf = pickNumber(params, "bf", COUNTS, ignored);
  if (bf !== undefined) view.before = bf;
  const af = pickNumber(params, "af", COUNTS, ignored);
  if (af !== undefined) view.after = af;

  const tn = params.get("tn");
  if (tn !== null) {
    if (tn === "all") view.topN = Infinity;
    else {
      const n = /^\d{1,2}$/.test(tn) ? Number(tn) : NaN;
      if (n === 3 || n === 5) view.topN = n;
      else ignored.push("tn");
    }
  }
  return { view, ignored };
}

// ---- pipeline ----

export const PIPELINE_FILTERS = {
  segment: PIPELINE_SEGMENTS,
  source: PIPELINE_SOURCES,
  stage: PIPELINE_STAGES,
  status: ["open", "won", "lost"],
} as const;

export type PipelineView = {
  selection: Partial<Record<"segment" | "source" | "stage" | "status", string[]>>;
  stageStep: 0 | 1 | 2;
  threshold: 14 | 30 | 60;
  cohortWindow: 30 | 60 | 90;
  recStage: 0 | 1 | 2 | 3;
  recWhich: "reached" | "open";
  /** UTC calendar date of the scrubber, YYYY-MM-DD. */
  scrubDate: string;
};

export function encodePipelineView(v: PipelineView): string {
  return [
    `v=${VERSION}`,
    ...selectionTo(v.selection, ["segment", "source", "stage", "status"]),
    `st=${v.stageStep}`,
    `th=${v.threshold}`,
    `cw=${v.cohortWindow}`,
    `rs=${v.recStage}`,
    `rw=${v.recWhich}`,
    `sd=${v.scrubDate}`,
  ].join("&");
}

function validDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const ms = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === text;
}

export function decodePipelineView(text: string): Result<PipelineView> {
  const parsed = parse(text);
  if ("stop" in parsed) return { view: {}, ignored: parsed.stop };
  const { params } = parsed;
  const ignored: string[] = [];
  const view: Partial<PipelineView> = {};

  view.selection = selectionFrom(params, PIPELINE_FILTERS, ignored) as PipelineView["selection"];
  const st = pickNumber(params, "st", [0, 1, 2] as const, ignored);
  if (st !== undefined) view.stageStep = st;
  const th = pickNumber(params, "th", [14, 30, 60] as const, ignored);
  if (th !== undefined) view.threshold = th;
  const cw = pickNumber(params, "cw", [30, 60, 90] as const, ignored);
  if (cw !== undefined) view.cohortWindow = cw;
  const rs = pickNumber(params, "rs", COUNTS, ignored);
  if (rs !== undefined) view.recStage = rs;
  const rw = pickWord(params, "rw", ["reached", "open"] as const, ignored);
  if (rw !== undefined) view.recWhich = rw;
  const sd = params.get("sd");
  if (sd !== null) {
    if (validDate(sd)) view.scrubDate = sd;
    else ignored.push("sd");
  }
  return { view, ignored };
}
