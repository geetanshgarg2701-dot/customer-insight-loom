"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { PathCount } from "@/lib/charts/anchored";
import { DESIGNED_JOURNEY, edgeCounts, stepStats, transitionsNotDesigned, wouldCreateCycle, type DesignedNode } from "@/lib/charts/designed";
import { formatDuration, type Timing } from "@/lib/charts/timing";
import { formatPercent } from "@/lib/app/format";
import { explainDesigned } from "@/lib/app/explain-views";
import { Explain } from "../explain";
import { CHART_THEME } from "./theme";

type StepData = {
  label: string;
  kind: DesignedNode["kind"];
  mainIndex: number | null;
  reached: boolean;
  entered: number;
  completed: number;
  endedHere: number;
  share: number;
  medianToNext: string | null;
  [key: string]: unknown;
};

const n = (v: number) => v.toLocaleString("en-US");

/** One step of the journey, with its live numbers as real text, so nothing depends on seeing the picture. */
function StepNode({ data }: NodeProps<Node<StepData>>) {
  return (
    <div
      style={{
        width: 160,
        padding: "8px 10px",
        background: "#fffdf8",
        color: CHART_THEME.text,
        border: `${data.kind === "branch" ? "1px dashed" : "2px solid"} ${data.kind === "branch" ? CHART_THEME.palette[1] : CHART_THEME.palette[0]}`,
        fontFamily: CHART_THEME.fontFamily,
        fontSize: 14,
        lineHeight: 1.35,
      }}
    >
      <Handle id="l" type="target" position={Position.Left} />
      <Handle id="r" type="source" position={Position.Right} />
      <Handle id="bt" type="target" position={Position.Bottom} style={{ left: "30%" }} />
      <Handle id="bs" type="source" position={Position.Bottom} style={{ left: "70%" }} />
      <strong style={{ fontSize: 17 }}>{data.label}</strong>
      <div>{data.kind === "branch" ? "Detour" : "Main step"}</div>
      {data.reached ? (
        <>
          <div>Entered {n(data.entered)}</div>
          <div>Went on {n(data.completed)}</div>
          <div>Ended here {n(data.endedHere)}</div>
          <div>{formatPercent(data.share, 1)} of everyone</div>
          <div>{data.medianToNext === null ? "Time to next not measured" : `Median to next ${data.medianToNext}`}</div>
        </>
      ) : (
        <div>Nobody reached this step.</div>
      )}
    </div>
  );
}

const nodeTypes = { step: StepNode };

const ARIA_LABELS = {
  "node.a11yDescription.default": "Press Enter or Space to open who is behind this step. Detours have no drill through yet.",
  "node.a11yDescription.keyboardDisabled": "Press Enter or Space to open who is behind this step.",
};

type Sketch = { from: string; to: string; loop: boolean };

/**
 * The journey as the marketer drew it, with live numbers on every step and a count on every connection. Selecting a main
 * step opens who is behind it. New connections can be sketched to see whether they would make a loop, and a sketch is
 * never saved and carries no customer numbers.
 */
export function JourneyCanvas({
  paths: livePaths,
  timing: liveTiming,
  onOpenStep,
}: {
  paths: PathCount[];
  timing: Timing | null;
  onOpenStep: (index: number) => void;
}) {
  // The canvas is the heaviest thing on the page to redraw. Deferring its numbers lets the urgent updates, the charts and
  // the "Updated in" figure, finish first, and the canvas catches up right after.
  const paths = useDeferredValue(livePaths);
  const timing = useDeferredValue(liveTiming);
  const stats = useMemo(() => stepStats(paths), [paths]);
  const counts = useMemo(() => edgeCounts(paths), [paths]);
  const missing = useMemo(() => transitionsNotDesigned(paths), [paths]);
  const [sketch, setSketch] = useState<Sketch[]>([]);
  const [from, setFrom] = useState("Cart");
  const [to, setTo] = useState("Product");
  const [message, setMessage] = useState<{ text: string; warn: boolean } | null>(null);
  const [opened, setOpened] = useState<string | null>(null);

  const stepIds = DESIGNED_JOURNEY.nodes.map((x) => x.id);

  /** Opens the step a node stands for. A main step opens who is behind it, and a detour says it has no drill through yet. */
  function openNode(id: string) {
    const d = DESIGNED_JOURNEY.nodes.find((x) => x.id === id);
    if (!d) return;
    if (d.mainIndex === null) {
      setOpened(`${d.label} is a detour. Who is behind a detour is not built yet.`);
    } else {
      onOpenStep(d.mainIndex);
      setOpened(`Opened who is behind ${d.label}, below under Behind a step.`);
    }
  }
  const maxCount = Math.max(1, ...DESIGNED_JOURNEY.edges.map((e) => counts.get(e.id) ?? 0));

  const nodes: Node<StepData>[] = useMemo(() => DESIGNED_JOURNEY.nodes.map((d) => {
    const s = stats.get(d.id);
    const median = d.mainIndex !== null ? timing?.steps[d.mainIndex]?.medianHours : null;
    const data: StepData = {
      label: d.label,
      kind: d.kind,
      mainIndex: d.mainIndex,
      reached: s !== undefined,
      entered: s?.entered ?? 0,
      completed: s?.completed ?? 0,
      endedHere: s?.endedHere ?? 0,
      share: s?.share ?? 0,
      medianToNext: median === null || median === undefined ? null : formatDuration(median),
    };
    return {
      id: d.id,
      type: "step",
      position: { x: d.x, y: d.y },
      data,
      width: 160,
      height: 130,
      ariaLabel: s
        ? `${d.label}, ${d.kind === "branch" ? "detour" : "main step"}. Entered ${n(s.entered)}, went on ${n(s.completed)}, ended here ${n(s.endedHere)}.`
        : `${d.label}. Nobody reached this step.`,
    };
  }), [stats, timing]);

  const designedEdges: Edge[] = useMemo(() => DESIGNED_JOURNEY.edges.map((e) => {
    const c = counts.get(e.id) ?? 0;
    return {
      id: e.id,
      source: e.from,
      target: e.to,
      sourceHandle: "r",
      targetHandle: "l",
      label: `${n(c)}`,
      style: { stroke: CHART_THEME.palette[0], strokeWidth: 1 + (6 * c) / maxCount },
      labelStyle: { fill: CHART_THEME.text, fontFamily: CHART_THEME.fontFamily, fontSize: 12 },
      markerEnd: { type: MarkerType.ArrowClosed, color: CHART_THEME.palette[0] },
    };
  }), [counts, maxCount]);

  // A sketched connection that makes a loop is a back-edge: it leaves from and arrives at the bottom of the steps.
  const sketchEdges: Edge[] = sketch.map((s, i) => ({
    id: `sketch-${i}-${s.from}>${s.to}`,
    source: s.from,
    target: s.to,
    sourceHandle: s.loop ? "bs" : "r",
    targetHandle: s.loop ? "bt" : "l",
    type: s.loop ? "smoothstep" : "default",
    label: s.loop ? "loop, sketch" : "sketch",
    style: { stroke: s.loop ? CHART_THEME.palette[3] : CHART_THEME.palette[2], strokeDasharray: "6 4", strokeWidth: 2 },
    labelStyle: { fill: CHART_THEME.text, fontFamily: CHART_THEME.fontFamily, fontSize: 12 },
    markerEnd: { type: MarkerType.ArrowClosed, color: s.loop ? CHART_THEME.palette[3] : CHART_THEME.palette[2] },
  }));

  function addConnection() {
    const all = [...DESIGNED_JOURNEY.edges, ...sketch];
    if (all.some((e) => e.from === from && e.to === to)) {
      setMessage({ text: `${from} to ${to} is already on the canvas.`, warn: false });
      return;
    }
    const loop = wouldCreateCycle(all, from, to);
    setSketch([...sketch, { from, to, loop }]);
    setMessage(
      loop
        ? {
            text: `This connection makes a loop: ${from} to ${to}. It is drawn as a dashed back edge below the steps. Check that the loop is intended.`,
            warn: true,
          }
        : { text: `Added ${from} to ${to} to the sketch. It is not saved and it has no customer numbers.`, warn: false },
    );
  }

  return (
    <div>
      <div
        style={{ height: 380, border: `1px solid ${CHART_THEME.line}`, background: "#faf8f4" }}
        onKeyDown={(e) => {
          // React Flow selects a focused node on Enter or Space but sends no click, so a keyboard user would never open it.
          if (e.key !== "Enter" && e.key !== " ") return;
          const el = (e.target as HTMLElement).closest("[data-id]");
          const id = el?.getAttribute("data-id");
          if (id && el?.classList.contains("react-flow__node")) openNode(id);
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={[...designedEdges, ...sketchEdges]}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          zoomOnScroll={false}
          preventScrolling={false}
          fitView
          fitViewOptions={{ padding: 0.04 }}
          minZoom={0.3}
          ariaLabelConfig={ARIA_LABELS}
          onNodeClick={(_, node) => openNode(node.id)}
        />
      </div>
      {opened && <p role="status">{opened}</p>}

      <p>
        <label>
          Sketch a connection from{" "}
          <select aria-label="From step" value={from} onChange={(e) => setFrom(e.target.value)}>
            {stepIds.map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
        </label>{" "}
        <label>
          to{" "}
          <select aria-label="To step" value={to} onChange={(e) => setTo(e.target.value)}>
            {stepIds.map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
        </label>{" "}
        <button type="button" onClick={addConnection}>
          Add connection to the sketch
        </button>{" "}
        <button
          type="button"
          disabled={sketch.length === 0}
          onClick={() => {
            setSketch([]);
            setMessage(null);
          }}
        >
          Clear the sketch
        </button>
      </p>
      {message && <p role={message.warn ? "alert" : "status"}>{message.text}</p>}

      <details>
        <summary>Show as table</summary>
        <table aria-label="Designed journey steps">
          <thead>
            <tr>
              <th scope="col">Step</th>
              <th scope="col">Kind</th>
              <th scope="col">Entered</th>
              <th scope="col">Went on</th>
              <th scope="col">Ended here</th>
              <th scope="col">Median to next</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((x) => (
              <tr key={x.id}>
                <td>{x.data.label}</td>
                <td>{x.data.kind === "branch" ? "Detour" : "Main step"}</td>
                <td>{n(x.data.entered)}</td>
                <td>{n(x.data.completed)}</td>
                <td>{n(x.data.endedHere)}</td>
                <td>{x.data.medianToNext ?? "not measured"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table aria-label="Designed journey connections">
          <thead>
            <tr>
              <th scope="col">From</th>
              <th scope="col">To</th>
              <th scope="col">Customers</th>
            </tr>
          </thead>
          <tbody>
            {DESIGNED_JOURNEY.edges.map((e) => (
              <tr key={e.id}>
                <td>{e.from}</td>
                <td>{e.to}</td>
                <td>{n(counts.get(e.id) ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <Explain summary="How the designed journey was worked out" items={explainDesigned(stats, missing, timing !== null)} />
    </div>
  );
}
