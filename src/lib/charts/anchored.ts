import { toPlainRow } from "../duckdb/normalize";
import type { SqlEngine } from "../intake/types";
import { whereClause, type SankeyEdge, type Selection } from "./crossfilter";

/**
 * The anchored path view. A person picks one event and sees what customers did just before and just after it. Each
 * customer who did the event is counted once, from the first time they did it. At every step the most common events
 * are named and the rest are grouped in one node that says how many kinds it holds, so nothing is hidden and the
 * counts still add up. A customer whose path ends is shown flowing into an "Ended" node instead of vanishing.
 */

export type PathCount = { path: string[]; count: number };

export type FlowNode = {
  name: string;
  /** Column, counted from the left edge of the chart. */
  depth: number;
  kind: "event" | "other" | "ended" | "began";
  count: number;
};

export type FlowColumn = {
  /** Steps from the anchor. Negative is before it. */
  offset: number;
  /** Customers who have an event at this step. */
  present: number;
  events: { name: string; count: number }[];
  other: { count: number; kinds: number };
};

export type AnchoredFlow = {
  anchor: string;
  before: number;
  after: number;
  /** Customers who did the anchor event. */
  customers: number;
  /** Customers in the data matching the filters, with or without the anchor. */
  outOf: number;
  nodes: FlowNode[];
  edges: SankeyEdge[];
  columns: FlowColumn[];
};

const MAX_STEPS = 4;

function checkSteps(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_STEPS) {
    throw new RangeError(`Steps ${label} must be a whole number from 0 to ${MAX_STEPS}.`);
  }
}

/** How a step is written: "anchor", "+2" or "-1". */
function tag(offset: number): string {
  return offset === 0 ? "anchor" : offset > 0 ? `+${offset}` : String(offset);
}

function eventName(offset: number, event: string): string {
  return offset === 0 ? `Anchor ${event}` : `${tag(offset)} ${event}`;
}

/** Events a person can anchor on, with how many customers did each, most first. */
export function anchorChoices(paths: readonly PathCount[]): { event: string; customers: number }[] {
  const byEvent = new Map<string, number>();
  for (const { path, count } of paths) {
    for (const event of new Set(path)) byEvent.set(event, (byEvent.get(event) ?? 0) + count);
  }
  return [...byEvent]
    .map(([event, customers]) => ({ event, customers }))
    .sort((a, b) => b.customers - a.customers || a.event.localeCompare(b.event));
}

export function anchoredFlow(
  paths: readonly PathCount[],
  options: { anchor: string; before: number; after: number; topN: number },
): AnchoredFlow {
  const { anchor, before, after, topN } = options;
  checkSteps(before, "before");
  checkSteps(after, "after");
  if (!(topN >= 1) || (Number.isFinite(topN) && !Number.isInteger(topN))) {
    throw new RangeError("The number of events shown per step must be a whole number from 1 up.");
  }

  const outOf = paths.reduce((s, p) => s + p.count, 0);
  const used = paths
    .map((p) => ({ events: p.path, at: p.path.indexOf(anchor), count: p.count }))
    .filter((p) => p.at >= 0);
  const customers = used.reduce((s, p) => s + p.count, 0);
  const empty: AnchoredFlow = { anchor, before, after, customers, outOf, nodes: [], edges: [], columns: [] };
  if (customers === 0) return empty;

  const eventAt = (p: (typeof used)[number], offset: number): string | null => p.events[p.at + offset] ?? null;

  // Which events are named in each column: the most common, then alphabetical, so the same data draws the same chart.
  const named = new Map<number, Set<string>>();
  const columns: FlowColumn[] = [];
  for (let offset = -before; offset <= after; offset++) {
    const counts = new Map<string, number>();
    let present = 0;
    for (const p of used) {
      const e = eventAt(p, offset);
      if (e === null) continue;
      present += p.count;
      counts.set(e, (counts.get(e) ?? 0) + p.count);
    }
    const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    // The anchor column has one event, so there is nothing to group.
    const keep = offset === 0 ? ranked : ranked.slice(0, topN);
    const rest = offset === 0 ? [] : ranked.slice(topN);
    named.set(offset, new Set(keep.map(([e]) => e)));
    columns.push({
      offset,
      present,
      events: keep.map(([name, count]) => ({ name, count })),
      other: { count: rest.reduce((s, [, c]) => s + c, 0), kinds: rest.length },
    });
  }

  const nodeOf = (offset: number, event: string): { name: string; kind: FlowNode["kind"] } =>
    named.get(offset)!.has(event)
      ? { name: eventName(offset, event), kind: "event" }
      : { name: `${tag(offset)} Other events`, kind: "other" };

  const nodes = new Map<string, FlowNode>();
  const edges = new Map<string, SankeyEdge>();
  const addNode = (name: string, depth: number, kind: FlowNode["kind"], count: number) => {
    const n = nodes.get(name);
    if (n) n.count += count;
    else nodes.set(name, { name, depth, kind, count });
  };
  const addEdge = (source: string, target: string, value: number) => {
    const key = `${source}\u0000${target}`;
    const e = edges.get(key);
    if (e) e.value += value;
    else edges.set(key, { source, target, value });
  };

  for (const p of used) {
    for (let offset = -before; offset <= after; offset++) {
      const here = eventAt(p, offset);
      if (here === null) continue;
      const me = nodeOf(offset, here);
      addNode(me.name, offset + before, me.kind, p.count);
      if (offset === after) continue;
      const next = eventAt(p, offset + 1);
      if (next !== null) {
        addEdge(me.name, nodeOf(offset + 1, next).name, p.count);
      } else {
        const ended = `Ended after ${tag(offset)}`;
        addNode(ended, offset + 1 + before, "ended", p.count);
        addEdge(me.name, ended, p.count);
      }
    }
    // A path that began after the left edge of the chart flows in from a "Began" node in the column before its start.
    const first = -p.at;
    if (first > -before) {
      const began = `Began at ${tag(first)}`;
      addNode(began, first - 1 + before, "began", p.count);
      addEdge(began, nodeOf(first, p.events[0]).name, p.count);
    }
  }

  return {
    anchor,
    before,
    after,
    customers,
    outOf,
    nodes: [...nodes.values()].sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name)),
    edges: [...edges.values()].sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target)),
    columns,
  };
}

/** Each distinct path with the number of customers who took it, for the filtered customers. */
export async function pathCounts(engine: SqlEngine, table: string, selection: Selection): Promise<PathCount[]> {
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new RangeError("Table name must be lower case letters, digits and underscores.");
  const where = whereClause(selection);
  const rows = await engine.query(`SELECT path, count(*) AS count FROM ${table} ${where.sql} GROUP BY path`, where.params);
  return rows.map(toPlainRow).map((r) => ({ path: String(r.path).split(" > "), count: Number(r.count) }));
}
