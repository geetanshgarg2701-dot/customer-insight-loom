"use client";

import type { DetourStep } from "@/lib/charts/behind";
import { useDeferredValue, useMemo, useState } from "react";
import { MarkerType, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { PathCount } from "@/lib/charts/anchored";
import { DESIGNED_JOURNEY, edgeCounts, stepStats, transitionsNotDesigned, wouldCreateCycle } from "@/lib/charts/designed";
import { finalStage, layoutBands, stageFromWait, withDetour, type StageParts } from "@/lib/charts/butterfly";
import { formatDuration, type Timing } from "@/lib/charts/timing";
import { INACTIVE_CHOICES, WAIT_CHOICES, type ExitResult, type WaitResult } from "@/lib/charts/rules";
import { downloadText } from "@/lib/app/download";
import { designToFile, markLoops, readDesignFile } from "@/lib/charts/design-file";
import { explainDesigned, explainRules } from "@/lib/app/explain-views";
import { Explain } from "../explain";
import { CSS_CHART } from "./theme";
import { BAND_EDGE_TYPES, BAND_NODE_TYPES, bandFlow } from "./flow-bands";

const n = (v: number) => v.toLocaleString("en-US");

const MAIN_STEPS = DESIGNED_JOURNEY.nodes.filter((d) => d.mainIndex !== null);
export type DesignedRules = { wait: WaitResult; exit: ExitResult };

/** The geometry of the bands: one scale for the whole flow, every pillar on one center line. */
const LAYOUT = { maxHeight: 220, centerY: 270, columnGap: 300, pillarWidth: 28 };

/** Which stage a node belongs to, so hovering or focusing any part of a stage lights up the whole stage. */
function stageOf(id: string): number | null {
  const main = MAIN_STEPS.findIndex((d) => d.id === id);
  if (main >= 0) return main;
  const detour = DESIGNED_JOURNEY.nodes.find((d) => d.id === id);
  if (detour && detour.mainIndex === null) return id === "Search" ? 0 : id === "Support" ? 2 : null;
  const stub = /^(?:drop|wait)-(\d)$/.exec(id);
  return stub ? Number(stub[1]) : null;
}

const ARIA_LABELS = {
  "node.a11yDescription.default": "Press Enter or Space to open who is behind this step.",
  "node.a11yDescription.keyboardDisabled": "Press Enter or Space to open who is behind this step.",
};

type Sketch = { from: string; to: string; loop: boolean };

/**
 * The journey as the marketer drew it, with live numbers on every step and a count on every connection. Selecting a step
 * or a detour opens who is behind it. New connections can be sketched to see whether they would make a loop, and a sketch is
 * never saved and carries no customer numbers.
 */
export function JourneyCanvas({
  paths: livePaths,
  timing: liveTiming,
  onOpenStep,
  onOpenDetour,
  rules,
  stageWaits: liveWaits,
  waitStep,
  waitDays,
  inactiveDays,
  onWaitStep,
  onWaitDays,
  onInactiveDays,
}: {
  paths: PathCount[];
  timing: Timing | null;
  onOpenStep: (index: number) => void;
  onOpenDetour: (step: DetourStep) => void;
  rules: DesignedRules | null;
  /** The wait counted after each of the first three stages, with the chosen length, for the bands. */
  stageWaits: WaitResult[] | null;
  waitStep: number;
  waitDays: number;
  inactiveDays: number;
  onWaitStep: (index: number) => void;
  onWaitDays: (days: number) => void;
  onInactiveDays: (days: number) => void;
}) {
  // The canvas is the heaviest thing on the page to redraw. Deferring its numbers lets the urgent updates, the charts and
  // the "Updated in" figure, finish first, and the canvas catches up right after.
  const paths = useDeferredValue(livePaths);
  const timing = useDeferredValue(liveTiming);
  const stageWaits = useDeferredValue(liveWaits);
  const stats = useMemo(() => stepStats(paths), [paths]);
  const counts = useMemo(() => edgeCounts(paths), [paths]);
  const missing = useMemo(() => transitionsNotDesigned(paths), [paths]);
  const [sketch, setSketch] = useState<Sketch[]>([]);
  const [from, setFrom] = useState("Cart");
  const [to, setTo] = useState("Product");
  const [message, setMessage] = useState<{ text: string; warn: boolean } | null>(null);
  const [opened, setOpened] = useState<string | null>(null);

  const stepIds = DESIGNED_JOURNEY.nodes.map((x) => x.id);

  /** Opens who is behind the step a node stands for, a main step or a detour. */
  function openNode(id: string) {
    if (id === "rule-wait" || id === "rule-exit") {
      setOpened(`${id === "rule-wait" ? "The wait" : "The exit conditions"} can be changed in the choices below the canvas.`);
      return;
    }
    const d = DESIGNED_JOURNEY.nodes.find((x) => x.id === id);
    if (!d) return;
    if (d.mainIndex === null) {
      onOpenDetour(d.id as DetourStep);
      setOpened(`Opened who is behind the ${d.label} detour, below under Behind a step.`);
    } else {
      onOpenStep(d.mainIndex);
      setOpened(`Opened who is behind ${d.label}, below under Behind a step.`);
    }
  }
  // The three parts of each stage, counted once by the wait rule. A detour's share can lag the wait by a moment, since they are
  // separate counts, so it is held between none and everyone who went on.
  const stages: StageParts[] | null = useMemo(() => {
    if (!stageWaits || stageWaits.length !== 3) return null;
    const via = [counts.get("Search>Product") ?? 0, 0, counts.get("Support>Purchase") ?? 0];
    const parts = stageWaits.map((w, k) => {
      const base = stageFromWait(w);
      return withDetour(base, Math.min(via[k], base.wentOn));
    });
    return [...parts, finalStage("Purchase", stats.get("Purchase")?.entered ?? 0)];
  }, [stageWaits, counts, stats]);
  const layout = useMemo(() => (stages ? layoutBands(stages, LAYOUT) : null), [stages]);
  const [activeStage, setActiveStage] = useState<number | null>(null);

  const flow = useMemo(() => {
    if (!layout) return { nodes: [] as Node[], edges: [] as Edge[] };
    const detours = [
      { id: "Search", label: "Search", count: stats.get("Search")?.entered ?? 0, fromStage: 0 },
      { id: "Support", label: "Support", count: stats.get("Support")?.entered ?? 0, fromStage: 2 },
    ];
    const built = bandFlow({ layout, detours, active: activeStage, columnGap: LAYOUT.columnGap, pillarWidth: LAYOUT.pillarWidth, labels: MAIN_STEPS.map((d) => d.label) });
    // Every number is also in the accessible name, so nothing depends on seeing the picture.
    const nodes = built.nodes.map((node) => {
      const k = MAIN_STEPS.findIndex((d) => d.id === node.id);
      if (k >= 0 && stages) {
        const s = stages[k];
        const label =
          s.next === null
            ? `${s.stage}, main step. Entered ${n(s.intake)}. Nobody goes on from here.`
            : `${s.stage}, main step. Entered ${n(s.intake)}, went on ${n(s.wentOn)}, dropped off ${n(s.droppedOff)}, still waiting ${n(s.stillWaiting)}.`;
        return { ...node, ariaLabel: label };
      }
      const detour = node.id === "Search" || node.id === "Support" ? stats.get(node.id) : undefined;
      if (detour) return { ...node, ariaLabel: `${node.id}, detour. Entered ${n(detour.entered)}, went on ${n(detour.completed)}, ended here ${n(detour.endedHere)}.` };
      return node;
    });
    return { nodes, edges: built.edges };
  }, [layout, stages, stats, activeStage]);

  /** What the panel says about one stage or detour. */
  function panelLines(k: number): string[] {
    if (!stages) return [];
    const s = stages[k];
    const median = timing?.steps[k]?.medianHours;
    if (s.next === null) {
      const lines = [`${n(s.intake)} reached ${s.stage}, the end of the journey.`];
      if (rules) {
        lines.push(`${n(rules.exit.goal)} reached the goal.`, `${n(rules.exit.inactive)} inactive for ${rules.exit.inactiveDays} days or more.`, `${n(rules.exit.active)} still active.`);
      }
      return lines;
    }
    const days = stageWaits?.[k]?.days ?? waitDays;
    const lines = [
      `${n(s.intake)} reached ${s.stage}.`,
      `${n(s.wentOn)} went on to ${s.next}${s.via > 0 ? `, ${n(s.via)} of them through a detour` : ""}.`,
      `${n(s.droppedOff)} dropped off. They had not moved on, and the wait of ${days} ${days === 1 ? "day" : "days"} was over at the data cutoff.`,
      `${n(s.stillWaiting)} still waiting. The wait of ${days} ${days === 1 ? "day" : "days"} was not over at the data cutoff.`,
    ];
    lines.push(median === null || median === undefined ? "Time to the next step is not measured." : `Median time to the next step is ${formatDuration(median)}.`);
    if (k === waitStep) lines.push(`Your designed wait of ${days} ${days === 1 ? "day" : "days"} is set here.`);
    return lines;
  }
  const panelTitle = activeStage === null || !stages ? null : stages[activeStage].stage;

  /** Hovering or focusing any part of a stage shows its numbers, the same for the pointer and the keyboard. */
  function activate(target: EventTarget | null) {
    const el = (target as HTMLElement | null)?.closest?.(".react-flow__node[data-id]");
    const id = el?.getAttribute("data-id");
    const k = id ? stageOf(id) : null;
    if (k !== null) setActiveStage(k);
  }

  // A sketched connection that makes a loop is a back-edge: it leaves from and arrives at the bottom of the steps.
  const sketchEdges: Edge[] = sketch.map((s, i) => ({
    id: `sketch-${i}-${s.from}>${s.to}`,
    source: s.from,
    target: s.to,
    sourceHandle: s.loop ? "bs" : "r",
    targetHandle: s.loop ? "bt" : "l",
    type: s.loop ? "smoothstep" : "default",
    label: s.loop ? "loop, sketch" : "sketch",
    style: { stroke: s.loop ? CSS_CHART.palette[3] : CSS_CHART.palette[2], strokeDasharray: "6 4", strokeWidth: 2 },
    labelStyle: { fill: CSS_CHART.text, fontFamily: CSS_CHART.fontFamily, fontSize: 12 },
      labelBgStyle: { fill: CSS_CHART.fill, stroke: CSS_CHART.line },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
    markerEnd: { type: MarkerType.ArrowClosed, color: s.loop ? CSS_CHART.palette[3] : CSS_CHART.palette[2] },
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
        : { text: `Added ${from} to ${to} to the sketch. It has no customer numbers. Save the design to a file to keep it.`, warn: false },
    );
  }

  /** Saves the design as a small file the person keeps. Nothing is stored in the browser and nothing is uploaded. */
  function saveDesign() {
    const text = designToFile({ waitStep, waitDays, inactiveDays, sketch: sketch.map((s) => ({ from: s.from, to: s.to })) }, new Date().toISOString());
    downloadText("journey-design.json", "application/json", text);
    setMessage({ text: "Saved journey-design.json. It holds the sketch, the wait and the exit rule, and no customer data.", warn: false });
  }

  /** Opens a saved design. A file that is not one of ours is refused whole, so nothing is half applied. */
  async function openDesign(file: File | undefined) {
    if (!file) return;
    try {
      const design = readDesignFile(await file.text());
      setSketch(markLoops(design.sketch));
      onWaitStep(design.waitStep);
      onWaitDays(design.waitDays);
      onInactiveDays(design.inactiveDays);
      const loops = markLoops(design.sketch).filter((x) => x.loop).length;
      setMessage({
        text: `Opened ${file.name}: ${design.sketch.length} sketched ${design.sketch.length === 1 ? "connection" : "connections"}, a ${design.waitDays} day wait, and an exit after ${design.inactiveDays} days inactive.${loops > 0 ? ` ${loops} of the connections make a loop. Check that the loops are intended.` : ""}`,
        warn: loops > 0,
      });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "That file could not be opened.", warn: true });
    }
  }

  return (
    <div>
      <div
        style={{ height: 560, border: `1px solid ${CSS_CHART.line}`, background: CSS_CHART.fill }}
        onMouseOver={(e) => activate(e.target)}
        onMouseLeave={() => setActiveStage(null)}
        onFocus={(e) => activate(e.target)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) setActiveStage(null);
        }}
        onKeyDown={(e) => {
          // React Flow selects a focused node on Enter or Space but sends no click, so a keyboard user would never open it.
          if (e.key !== "Enter" && e.key !== " ") return;
          const el = (e.target as HTMLElement).closest("[data-id]");
          const id = el?.getAttribute("data-id");
          if (id && el?.classList.contains("react-flow__node")) openNode(id);
        }}
      >
        <ReactFlow
          // The view fits the nodes when it starts, and the bands arrive a moment later, so it starts again once they have.
          key={layout ? "with-bands" : "without-bands"}
          nodes={flow.nodes}
          edges={[...flow.edges, ...sketchEdges]}
          nodeTypes={BAND_NODE_TYPES}
          edgeTypes={BAND_EDGE_TYPES}
          nodesDraggable={false}
          nodesConnectable={false}
          zoomOnScroll={false}
          preventScrolling={false}
          fitView
          fitViewOptions={{ padding: 0.04, minZoom: 0.7 }}
          minZoom={0.3}
          onInit={(rf) => {
            // On a narrow screen the whole picture cannot be read at once, so it starts at the first step and the person drags along it.
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                const v = rf.getViewport();
                if (v.zoom <= 0.7 + 1e-6) void rf.setViewport({ x: 16, y: v.y, zoom: v.zoom });
              }),
            );
          }}
          ariaLabelConfig={ARIA_LABELS}
          onNodeClick={(_, node) => openNode(node.id)}
        />
        <div className="flow-panel" data-open={panelTitle ? "true" : undefined} aria-hidden={panelTitle ? undefined : true}>
          {panelTitle && activeStage !== null ? (
            <>
              <strong>{panelTitle}</strong>
              <ul>
                {panelLines(activeStage).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          ) : (
            <span>Point at a step, or move to it with the keyboard, to see its numbers.</span>
          )}
        </div>
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
      <p>
        <button type="button" onClick={saveDesign}>
          Save the design to a file
        </button>{" "}
        <label>
          Open a saved design{" "}
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              void openDesign(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </p>
      {message && <p role={message.warn ? "alert" : "status"}>{message.text}</p>}

      <p>
        <label>
          Designed wait after{" "}
          <select aria-label="Wait after step" value={waitStep} onChange={(e) => onWaitStep(Number(e.target.value))}>
            {MAIN_STEPS.slice(0, -1).map((d, i) => (
              <option key={d.id} value={i}>
                {d.label}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          for{" "}
          <select aria-label="Wait length" value={waitDays} onChange={(e) => onWaitDays(Number(e.target.value))}>
            {WAIT_CHOICES.map((d) => (
              <option key={d} value={d}>
                {d} {d === 1 ? "day" : "days"}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          Exit when inactive for{" "}
          <select aria-label="Inactivity rule" value={inactiveDays} onChange={(e) => onInactiveDays(Number(e.target.value))}>
            {INACTIVE_CHOICES.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
      </p>
      <p>
        Each step is a pillar as tall as the people who reached it. Those who went on run along the trunk, those who dropped off
        run down, and those still waiting run up. Every band is as thick as its count, on one scale. The wait and the exit
        conditions are designed rules. The counts on them come from the data and follow the filters, and a rule does not send
        anything.
      </p>

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
            {DESIGNED_JOURNEY.nodes.map((d) => {
              const st = stats.get(d.id);
              const median = d.mainIndex !== null ? timing?.steps[d.mainIndex]?.medianHours : null;
              return (
                <tr key={d.id}>
                  <td>{d.label}</td>
                  <td>{d.kind === "branch" ? "Detour" : "Main step"}</td>
                  <td>{n(st?.entered ?? 0)}</td>
                  <td>{n(st?.completed ?? 0)}</td>
                  <td>{n(st?.endedHere ?? 0)}</td>
                  <td>{median === null || median === undefined ? "not measured" : formatDuration(median)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {stages && (
          <table aria-label="Journey bands">
            <thead>
              <tr>
                <th scope="col">Stage</th>
                <th scope="col">Reached</th>
                <th scope="col">Went on</th>
                <th scope="col">Dropped off</th>
                <th scope="col">Still waiting</th>
                <th scope="col">Parts add up to those who reached it</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((s) => (
                <tr key={s.stage}>
                  <td>{s.stage}</td>
                  <td>{n(s.intake)}</td>
                  <td>{s.next === null ? "not applicable" : n(s.wentOn)}</td>
                  <td>{s.next === null ? "not applicable" : n(s.droppedOff)}</td>
                  <td>{s.next === null ? "not applicable" : n(s.stillWaiting)}</td>
                  <td>{s.next === null ? "not applicable" : s.wentOn + s.droppedOff + s.stillWaiting === s.intake ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rules && (
          <table aria-label="Designed rules">
            <thead>
              <tr>
                <th scope="col">Rule</th>
                <th scope="col">Group</th>
                <th scope="col">People</th>
              </tr>
            </thead>
            <tbody>
              {[
                [`Wait ${rules.wait.days} ${rules.wait.days === 1 ? "day" : "days"} after ${rules.wait.step}`, `Went on to ${rules.wait.next} within the wait`, rules.wait.within],
                [`Wait ${rules.wait.days} ${rules.wait.days === 1 ? "day" : "days"} after ${rules.wait.step}`, "Went on later", rules.wait.later],
                [`Wait ${rules.wait.days} ${rules.wait.days === 1 ? "day" : "days"} after ${rules.wait.step}`, "Still waiting at the cutoff", rules.wait.stillWaiting],
                [`Wait ${rules.wait.days} ${rules.wait.days === 1 ? "day" : "days"} after ${rules.wait.step}`, "Sat through the whole wait", rules.wait.outlasted],
                ["Exit conditions", "Reached the goal", rules.exit.goal],
                ["Exit conditions", `Inactive for ${rules.exit.inactiveDays} days or more`, rules.exit.inactive],
                ["Exit conditions", "Still active", rules.exit.active],
              ].map(([rule, group, count]) => (
                <tr key={`${rule}-${group}`}>
                  <td>{rule}</td>
                  <td>{group}</td>
                  <td>{n(count as number)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
      {rules && <Explain summary="How the wait and exit conditions were worked out" items={explainRules(rules.wait, rules.exit)} />}
    </div>
  );
}
