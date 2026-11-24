"use client";

import type { KeyboardEvent } from "react";
import type { FunnelStage } from "@/lib/charts/pipeline";
import { bandPath, layoutFunnel } from "@/lib/charts/funnel-bands";
import { TableScroll } from "../range-bar";

/**
 * The stage funnel as bands, in the same style as the journey picture. A pillar for each stage as tall as the deals that reached
 * it, measured from zero on one scale. The top slice of a pillar, those that reached the next stage, runs straight across to the
 * next pillar. The bottom slice, those that did not, curves down into a line of text. A stage can be pressed to filter by it, with
 * the pointer or the keyboard. The table under it carries the same numbers.
 */

const n = (v: number) => v.toLocaleString("en-US");
const PILLAR = 26;
const GAP = 190;
const TOP = 46;
const MAX_HEIGHT = 150;
const DROP_RUN = 78;
/** A small gap between a pillar and the bands, so each stage stays a separate mark. */
const SEAM = 4;
const DROP_FALL = 46;

export function FunnelBands({ funnel, selected, onToggle }: { funnel: FunnelStage[]; selected: string[]; onToggle: (stage: string) => void }) {
  if (funnel.length === 0) return null;
  const layout = layoutFunnel(funnel, { maxHeight: MAX_HEIGHT, top: TOP, columnGap: GAP });
  const width = (layout.length - 1) * GAP + PILLAR + 150;
  const height = TOP + MAX_HEIGHT + DROP_FALL + 40;
  const press = (stage: string) => (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle(stage);
    }
  };
  return (
    <figure aria-label="Deals that reached each stage" style={{ margin: 0 }}>
      <TableScroll label="Stage funnel picture">
        <svg className="fb" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="group" aria-label="Stage funnel drawn as bands. The same numbers are in the table below.">
          {layout.map((s, i) => {
            const isSelected = selected.includes(s.stage);
            const next = layout[i + 1];
            const tone = isSelected ? "fb-on" : "fb-ink";
            const name =
              s.next === null
                ? `${s.stage} ${n(s.count)}, deals that reached it. Press to filter by this stage.`
                : `${s.stage} ${n(s.count)}, deals that reached it. ${n(s.wentOn)} also reached ${s.next} and ${n(s.didNot)} did not. Press to filter by this stage.`;
            const dropEndY = TOP + s.height + DROP_FALL;
            return (
              <g key={s.stage}>
                {next && s.wentH > 0 && <path className={`fb-trunk ${tone}`} d={bandPath(s.x + PILLAR + SEAM, s.top, s.top + s.wentH, next.x - SEAM, next.top, next.top + s.wentH)} />}
                {s.didNotH > 0 && (
                  <>
                    <path className="fb-drop" d={bandPath(s.x + PILLAR + SEAM, s.top + s.wentH, s.top + s.height, s.x + PILLAR + SEAM + DROP_RUN, dropEndY - s.didNotH / 2, dropEndY + s.didNotH / 2)} />
                    <text className="fb-note" x={s.x + PILLAR + SEAM + DROP_RUN + 8} y={dropEndY + 4}>
                      {`Did not reach ${s.next} ${n(s.didNot)}`}
                    </text>
                  </>
                )}
                <g className="fb-stage" role="button" tabIndex={0} aria-pressed={isSelected} aria-label={name} onClick={() => onToggle(s.stage)} onKeyDown={press(s.stage)}>
                  <rect className={`fb-pillar ${tone}`} x={s.x} y={s.top} width={PILLAR} height={Math.max(s.height, 1)} />
                  {/* A larger target for the pointer, with no fill of its own. */}
                  <rect className="fb-hit" x={s.x - 6} y={s.top - 36} width={PILLAR + 96} height={Math.max(s.height, 1) + 40} />
                  {/* One text, so the visible words read as the stage and then its count, which is how the button is named. */}
                  <text x={s.x} y={s.top - 20}>
                    <tspan className="fb-name">{s.stage}</tspan>{" "}
                    <tspan className="fb-count" x={s.x} dy={15}>
                      {n(s.count)}
                    </tspan>
                  </text>
                </g>
              </g>
            );
          })}
        </svg>
      </TableScroll>
    </figure>
  );
}
