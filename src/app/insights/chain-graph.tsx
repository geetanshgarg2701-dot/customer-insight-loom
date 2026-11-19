"use client";

import { useMemo } from "react";
import { Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CHAIN_NODE, chainGraph, type ChainNode } from "@/lib/insights/chain-graph";
import type { ChainStep } from "@/lib/insights/evidence";
import { CHART_THEME } from "../journeys/theme";

type Data = ChainNode & { [key: string]: unknown };

/** The links cannot be rewired, so the connection points are not drawn. */
const HIDDEN = { opacity: 0, pointerEvents: "none" } as const;

/** One link of the chain, with its words as real text. A missing link is drawn dashed and says so. */
function LinkNode({ data }: NodeProps<Node<Data>>) {
  return (
    <div
      style={{
        width: CHAIN_NODE.width,
        minHeight: CHAIN_NODE.height,
        boxSizing: "border-box",
        padding: "8px 10px",
        background: "#fffdf8",
        color: CHART_THEME.text,
        border: `${data.missing ? "1px dashed" : "2px solid"} ${data.missing ? CHART_THEME.line : CHART_THEME.palette[0]}`,
        fontFamily: CHART_THEME.fontFamily,
        fontSize: 13,
        lineHeight: 1.35,
      }}
    >
      <Handle id="l" type="target" position={Position.Left} style={HIDDEN} />
      <Handle id="r" type="source" position={Position.Right} style={HIDDEN} />
      <Handle id="t" type="target" position={Position.Top} style={HIDDEN} />
      <Handle id="b" type="source" position={Position.Bottom} style={HIDDEN} />
      <strong style={{ fontSize: 15 }}>{data.label}</strong>
      {data.missing && <div>Missing</div>}
      <div>{data.text}</div>
    </div>
  );
}

const nodeTypes = { link: LinkNode };

const ARIA_LABELS = {
  "node.a11yDescription.default": "One link of the evidence chain. The same words are in the list below.",
  "node.a11yDescription.keyboardDisabled": "One link of the evidence chain. The same words are in the list below.",
};

/**
 * The chain drawn as a graph for wide screens, plan M6. Every link can be reached with Tab and is read out with its full
 * words. On a phone it is not shown and the list below is the chain.
 */
export function ChainGraph({ steps, title }: { steps: ChainStep[]; title: string }) {
  const graph = useMemo(() => chainGraph(steps), [steps]);
  const nodes: Node<Data>[] = graph.nodes.map((n) => ({
    id: n.id,
    type: "link",
    position: { x: n.x, y: n.y },
    data: n as Data,
    width: CHAIN_NODE.width,
    height: CHAIN_NODE.height,
    ariaLabel: n.ariaLabel,
  }));
  // The third link ends the first row, so its edge to the fourth runs from its bottom to the top of the second row.
  const edges: Edge[] = graph.edges.map((e, i) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: i === 2 ? "b" : "r",
    targetHandle: i === 2 ? "t" : "l",
    type: i === 2 ? "smoothstep" : "default",
    style: { stroke: CHART_THEME.palette[0], strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: CHART_THEME.palette[0] },
  }));
  return (
    <div className="chain-graph" role="group" aria-label={title} style={{ height: 2 * CHAIN_NODE.height + 120 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        zoomOnScroll={false}
        panOnDrag={false}
        preventScrolling={false}
        fitView
        fitViewOptions={{ padding: 0.04 }}
        minZoom={0.3}
        ariaLabelConfig={ARIA_LABELS}
      />
    </div>
  );
}
