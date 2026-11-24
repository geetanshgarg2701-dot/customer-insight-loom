"use client";

import { useEffect } from "react";
import {
  BaseEdge,
  Handle,
  Position,
  getBezierPath,
  useUpdateNodeInternals,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import type { StageLayout } from "@/lib/charts/butterfly";
import { CSS_CHART } from "./theme";

/**
 * The journey as proportional bands, drawn with React Flow's nodes and edges: a pillar for each stage as tall as the people who
 * reached it, a trunk of those who went on, a branch down for those who dropped off and a branch up for those still waiting.
 * Every thickness comes from butterfly.ts, so the same count is the same thickness everywhere. Connector points are present, since
 * the library needs them, and are invisible.
 */

const n = (v: number) => v.toLocaleString("en-US");
const HIDDEN = { opacity: 0, pointerEvents: "none" } as const;
const INK = "var(--text-2)";

export type StageData = {
  label: string;
  intake: number;
  width: number;
  height: number;
  active: boolean;
  /** Where each band meets the pillar, measured down from its top. */
  out: { wait: number; direct: number; detour: number; drop: number };
  into: { direct: number; detour: number };
  [key: string]: unknown;
};

function StageNode({ id, data }: NodeProps<Node<StageData>>) {
  const update = useUpdateNodeInternals();
  const key = JSON.stringify([data.height, data.out, data.into]);
  // The connection points move when the numbers change, so the library is told to measure them again.
  useEffect(() => {
    update(id);
  }, [id, key, update]);
  const at = (top: number) => ({ ...HIDDEN, top });
  return (
    <div className="flow-stage" data-active={data.active ? "true" : undefined} style={{ width: data.width, height: data.height }}>
      <span className="flow-stage-label">
        {data.label}
        <b>{n(data.intake)}</b>
      </span>
      <Handle id="l" type="target" position={Position.Left} style={HIDDEN} isConnectable={false} />
      <Handle id="bt" type="target" position={Position.Bottom} style={{ ...HIDDEN, left: "30%" }} isConnectable={false} />
      <Handle id="inDirect" type="target" position={Position.Left} style={at(data.into.direct)} isConnectable={false} />
      <Handle id="inDetour" type="target" position={Position.Left} style={at(data.into.detour)} isConnectable={false} />
      <Handle id="r" type="source" position={Position.Right} style={HIDDEN} isConnectable={false} />
      <Handle id="bs" type="source" position={Position.Bottom} style={{ ...HIDDEN, left: "70%" }} isConnectable={false} />
      <Handle id="wait" type="source" position={Position.Right} style={at(data.out.wait)} isConnectable={false} />
      <Handle id="direct" type="source" position={Position.Right} style={at(data.out.direct)} isConnectable={false} />
      <Handle id="detour" type="source" position={Position.Right} style={at(data.out.detour)} isConnectable={false} />
      <Handle id="drop" type="source" position={Position.Right} style={at(data.out.drop)} isConnectable={false} />
    </div>
  );
}

export type StubData = { text: string; height: number; active: boolean; [key: string]: unknown };

/** The end of a branch: the band runs into a short line of text that says what it is and how many. */
function StubNode({ data }: NodeProps<Node<StubData>>) {
  return (
    <div className="flow-stub" data-active={data.active ? "true" : undefined} style={{ height: Math.max(data.height, 22) }}>
      <span>{data.text}</span>
      <Handle id="in" type="target" position={Position.Left} style={HIDDEN} isConnectable={false} />
    </div>
  );
}

export type TabData = { label: string; count: number; active: boolean; [key: string]: unknown };

/** A detour such as Search, drawn as a small labeled tab on its band. It can be focused and opened. */
function TabNode({ data }: NodeProps<Node<TabData>>) {
  return (
    <div className="flow-tab" data-active={data.active ? "true" : undefined}>
      {data.label}
      <b>{n(data.count)}</b>
      <Handle id="l" type="target" position={Position.Left} style={HIDDEN} isConnectable={false} />
      <Handle id="r" type="source" position={Position.Right} style={HIDDEN} isConnectable={false} />
      <Handle id="bt" type="target" position={Position.Bottom} style={{ ...HIDDEN, left: "30%" }} isConnectable={false} />
      <Handle id="bs" type="source" position={Position.Bottom} style={{ ...HIDDEN, left: "70%" }} isConnectable={false} />
    </div>
  );
}

export type BandData = { width: number; tone: "ink" | "mark"; active: boolean; [key: string]: unknown };

/** An edge as thick as its count. */
function BandEdge(props: EdgeProps<Edge<BandData>>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const color = data?.active ? CSS_CHART.selected : data?.tone === "ink" ? INK : CSS_CHART.mark;
  return <BaseEdge id={props.id} className="band" path={path} style={{ stroke: color, strokeWidth: data?.width ?? 1, fill: "none", strokeLinecap: "butt" }} interactionWidth={0} />;
}

export const BAND_NODE_TYPES = { stage: StageNode, stub: StubNode, tab: TabNode };
export const BAND_EDGE_TYPES = { band: BandEdge };

type FlowInput = {
  layout: readonly StageLayout[];
  /** How many reached each detour, and how many of those went on, keyed by the detour's name. */
  detours: readonly { id: string; label: string; count: number; fromStage: number }[];
  active: number | null;
  columnGap: number;
  pillarWidth: number;
  labels: readonly string[];
};

const LABEL_ROOM = 70;
const STUB_DX = 130;
const STUB_DY = 70;
const TAB_DY = 84;

/** The nodes and edges for the bands. Nothing is drawn for a band of nobody. */
export function bandFlow(input: FlowInput): { nodes: Node[]; edges: Edge[] } {
  const { layout, detours, active, pillarWidth } = input;
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const isActive = (k: number) => active === k;
  layout.forEach((s, k) => {
    const prev = k > 0 ? layout[k - 1] : null;
    nodes.push({
      id: s.stage,
      type: "stage",
      position: { x: s.x, y: s.top },
      // The node is wider than the pillar so the view leaves room for the name and count written beside it.
      width: pillarWidth + LABEL_ROOM,
      height: Math.max(s.height, 2),
      data: {
        label: s.stage,
        intake: s.intake,
        width: pillarWidth,
        height: Math.max(s.height, 2),
        active: isActive(k),
        out: { wait: s.waitY - s.top, direct: s.directY - s.top, detour: s.detourY - s.top, drop: s.dropY - s.top },
        into: prev ? { detour: prev.detourH / 2, direct: prev.detourH + prev.directH / 2 } : { detour: 0, direct: 0 },
      } satisfies StageData,
      ariaLabel: `${s.stage}, main step. ${n(s.intake)} reached it.`,
      selectable: true,
    });
    if (s.next === null) return;
    const next = layout[k + 1];
    const band = (id: string, source: string, sourceHandle: string, target: string, targetHandle: string, width: number, tone: BandData["tone"]) => {
      if (width <= 0) return;
      edges.push({ id, source, target, sourceHandle, targetHandle, type: "band", data: { width, tone, active: isActive(k) } satisfies BandData, selectable: false, focusable: false });
    };
    // The trunk: those who went straight on.
    if (next) band(`${s.stage}>${next.stage}`, s.stage, "direct", next.stage, "inDirect", s.directH, "ink");
    // Those who dropped off run down into a line of text, and those still waiting run up into another.
    if (s.droppedH > 0) {
      nodes.push({ id: `drop-${k}`, type: "stub", position: { x: s.x + STUB_DX, y: s.dropY + STUB_DY - Math.max(s.droppedH, 22) / 2 }, width: 160, height: Math.max(s.droppedH, 22), data: { text: `Dropped off ${n(s.droppedOff)}`, height: s.droppedH, active: isActive(k) } satisfies StubData, focusable: false, selectable: false, draggable: false });
      band(`${s.stage}>drop`, s.stage, "drop", `drop-${k}`, "in", s.droppedH, "mark");
    }
    // A band of nobody is not drawn, so a count of zero is in the panel and the table, not floating on the picture.
    if (s.stillWaitingH > 0) {
      nodes.push({ id: `wait-${k}`, type: "stub", position: { x: s.x + STUB_DX, y: s.waitY - STUB_DY - Math.max(s.stillWaitingH, 22) / 2 }, width: 160, height: Math.max(s.stillWaitingH, 22), data: { text: `Still waiting ${n(s.stillWaiting)}`, height: s.stillWaitingH, active: isActive(k) } satisfies StubData, focusable: false, selectable: false, draggable: false });
      band(`${s.stage}>wait`, s.stage, "wait", `wait-${k}`, "in", s.stillWaitingH, "mark");
    }
  });
  // Detours sit on a tab above the trunk, with a band of their own in and out.
  for (const d of detours) {
    const from = layout[d.fromStage];
    const to = layout[d.fromStage + 1];
    if (!from || !to) continue;
    const width = from.wentOn > 0 ? from.detourH : 0;
    const x = from.x + input.columnGap / 2 - 50;
    nodes.push({ id: d.id, type: "tab", position: { x, y: from.top - TAB_DY }, width: 100, height: 26, data: { label: d.label, count: d.count, active: isActive(d.fromStage) } satisfies TabData, ariaLabel: `${d.label}, detour. ${n(d.count)} reached it.` });
    if (width > 0) {
      edges.push({ id: `${from.stage}>${d.id}`, source: from.stage, target: d.id, sourceHandle: "detour", targetHandle: "l", type: "band", data: { width, tone: "ink", active: isActive(d.fromStage) } satisfies BandData, selectable: false, focusable: false });
      edges.push({ id: `${d.id}>${to.stage}`, source: d.id, target: to.stage, sourceHandle: "r", targetHandle: "inDetour", type: "band", data: { width, tone: "ink", active: isActive(d.fromStage) } satisfies BandData, selectable: false, focusable: false });
    }
  }
  return { nodes, edges };
}
