import type { PathCount } from "./anchored";

/**
 * The designed journey canvas, as plain data and pure functions, so it can be tested without a browser. The design is
 * the synthetic demo's journey as a marketer would draw it: four main steps and two detours. The live numbers on each
 * step come from the real path counts. Nothing on the canvas is typed in by hand except the design itself.
 *
 * Not built: wait steps and exit conditions as designed nodes, and editing a saved design. Connections can be sketched
 * to see whether they would make a loop, but a sketch is never saved.
 */

export type DesignedNode = {
  id: string;
  label: string;
  kind: "step" | "branch";
  x: number;
  y: number;
  /** Position among the four main steps, or null for a detour. Used to link a node to its time and drill through. */
  mainIndex: number | null;
};
export type DesignedEdge = { id: string; from: string; to: string };

export const DESIGNED_JOURNEY: { nodes: DesignedNode[]; edges: DesignedEdge[] } = {
  nodes: [
    { id: "Visit", label: "Visit", kind: "step", x: 0, y: 170, mainIndex: 0 },
    { id: "Search", label: "Search", kind: "branch", x: 190, y: 0, mainIndex: null },
    { id: "Product", label: "Product", kind: "step", x: 380, y: 170, mainIndex: 1 },
    { id: "Cart", label: "Cart", kind: "step", x: 650, y: 170, mainIndex: 2 },
    { id: "Support", label: "Support", kind: "branch", x: 845, y: 0, mainIndex: null },
    { id: "Purchase", label: "Purchase", kind: "step", x: 1040, y: 170, mainIndex: 3 },
  ],
  edges: [
    { id: "Visit>Product", from: "Visit", to: "Product" },
    { id: "Visit>Search", from: "Visit", to: "Search" },
    { id: "Search>Product", from: "Search", to: "Product" },
    { id: "Product>Cart", from: "Product", to: "Cart" },
    { id: "Cart>Purchase", from: "Cart", to: "Purchase" },
    { id: "Cart>Support", from: "Cart", to: "Support" },
    { id: "Support>Purchase", from: "Support", to: "Purchase" },
  ],
};

export type NodeStats = {
  /** Customers who reached the step, each counted once. */
  entered: number;
  /** Of them, how many had an event after it. */
  completed: number;
  /** Of them, how many had it as their last event. */
  endedHere: number;
  /** Entered over everyone who entered the journey. */
  share: number;
};

/** Live numbers for every step that appears in the paths. A step nobody reached is absent. */
export function stepStats(paths: readonly PathCount[]): Map<string, NodeStats> {
  const entered = new Map<string, number>();
  const ended = new Map<string, number>();
  let everyone = 0;
  for (const { path, count } of paths) {
    everyone += count;
    for (const step of new Set(path)) entered.set(step, (entered.get(step) ?? 0) + count);
    const last = path[path.length - 1];
    ended.set(last, (ended.get(last) ?? 0) + count);
  }
  const out = new Map<string, NodeStats>();
  for (const [step, n] of entered) {
    const endedHere = ended.get(step) ?? 0;
    out.set(step, { entered: n, completed: n - endedHere, endedHere, share: everyone === 0 ? 0 : n / everyone });
  }
  return out;
}

/** How many customers went directly from one step to the next, keyed "From>To". */
export function edgeCounts(paths: readonly PathCount[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const { path, count } of paths) {
    for (let i = 1; i < path.length; i++) {
      const key = `${path[i - 1]}>${path[i]}`;
      out.set(key, (out.get(key) ?? 0) + count);
    }
  }
  return out;
}

/** Transitions customers made that the design has no edge for, so a design that misdescribes the data is visible. */
export function transitionsNotDesigned(paths: readonly PathCount[], design = DESIGNED_JOURNEY): string[] {
  const known = new Set(design.edges.map((e) => e.id));
  return [...edgeCounts(paths).keys()].filter((k) => !known.has(k)).sort();
}

/** True when adding from to `to` would close a loop: `to` already leads back to `from`, or they are the same step. */
export function wouldCreateCycle(edges: readonly { from: string; to: string }[], from: string, to: string): boolean {
  if (from === to) return true;
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length > 0) {
    const step = stack.pop()!;
    if (step === from) return true;
    if (seen.has(step)) continue;
    seen.add(step);
    stack.push(...(next.get(step) ?? []));
  }
  return false;
}
