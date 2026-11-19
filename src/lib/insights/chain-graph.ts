/**
 * The evidence chain as a graph, plan M6: from the theme to the decision. Laid out by hand in two rows of three, which
 * fits a laptop without auto layout, so no layout library is needed. The words are the chain's own, so the graph and the
 * list below it cannot say different things.
 */
import type { ChainStep } from "./evidence";

export const CHAIN_NODE = { width: 260, height: 210 } as const;
const GAP_X = 50;
const GAP_Y = 60;
const ORDER: readonly ChainStep["kind"][] = ["theme", "segment", "path", "revenue", "test", "decision"];

export type ChainNode = {
  id: ChainStep["kind"];
  x: number;
  y: number;
  label: string;
  text: string;
  missing: boolean;
  entryId?: string;
  ariaLabel: string;
};
export type ChainEdge = { id: string; source: string; target: string };

export function chainGraph(steps: readonly ChainStep[]): { nodes: ChainNode[]; edges: ChainEdge[] } {
  if (steps.length !== ORDER.length || steps.some((s, i) => s.kind !== ORDER[i])) {
    throw new RangeError("The chain must be the six links in order.");
  }
  const nodes = steps.map((s, i) => {
    const row = Math.floor(i / 3);
    const col = i % 3;
    const missing = s.status === "missing";
    return {
      id: s.kind,
      x: col * (CHAIN_NODE.width + GAP_X),
      y: row * (CHAIN_NODE.height + GAP_Y),
      label: s.label,
      text: s.text,
      missing,
      ...(s.entryId ? { entryId: s.entryId } : {}),
      ariaLabel: `${i + 1} of ${steps.length}. ${s.label}. ${missing ? "Missing. " : ""}${s.text}`,
    };
  });
  const edges = nodes.slice(1).map((n, i) => ({ id: `${nodes[i].id}>${n.id}`, source: nodes[i].id, target: n.id }));
  return { nodes, edges };
}
