import type { ReactNode } from "react";
import { place, type Axis } from "@/lib/app/range";

/**
 * A rate and its range, drawn in a table row on an axis shared by the whole table: a dot for the rate and a whisker for the range.
 * It is added next to the written numbers and never replaces them. Each picture has one sentence for a screen reader.
 */

/** The header of the picture column. It carries the shared axis, labeled, so every row reads against the same scale. */
export function RangeHeader({ axis }: { axis: Axis }) {
  const unit = axis.signed ? "points" : "percent";
  const first = axis.ticks[0];
  const last = axis.ticks[axis.ticks.length - 1];
  const spoken = axis.signed
    ? `Range picture, axis from minus ${Math.abs(first)} to plus ${last} points, zero in the middle`
    : `Range picture, axis from 0 to ${last} percent`;
  const tick = (t: number) => (axis.signed && t > 0 ? `+${t}` : String(t));
  return (
    <th scope="col" className="rb-col" aria-label={spoken}>
      <span aria-hidden="true">Range, {unit}</span>
      <span className="rb-ticks" aria-hidden="true">
        {axis.ticks.map((t, i) => (
          <span key={t} data-end={i === 0 ? "start" : i === axis.ticks.length - 1 ? "end" : undefined} style={{ left: `${axis.at(t)}%` }}>
            {tick(t)}
          </span>
        ))}
      </span>
    </th>
  );
}

/** One row's dot and whisker. A range that crosses zero is drawn dashed, so it reads as crossing without relying on color. */
export function RangeCell({ axis, value, low, high, sentence }: { axis: Axis; value: number; low: number; high: number; sentence: string }) {
  const p = place(axis, value, low, high);
  if (!p) return <td className="rb-col" />;
  return (
    <td className="rb-col">
      <div className="rb" role="img" aria-label={sentence} data-crosses={axis.signed && p.crossesZero ? "true" : undefined}>
        <i className="rb-axis" aria-hidden="true" />
        {axis.signed && <i className="rb-zero" aria-hidden="true" style={{ left: `${axis.at(0)}%` }} />}
        <i className="rb-whisker" aria-hidden="true" style={{ left: `${p.leftPct}%`, width: `${p.widthPct}%` }} />
        <i className="rb-cap" aria-hidden="true" style={{ left: `${p.leftPct}%` }} />
        <i className="rb-cap" aria-hidden="true" style={{ left: `${p.leftPct + p.widthPct}%` }} />
        <i className="rb-dot" aria-hidden="true" style={{ left: `${p.dotPct}%` }} />
      </div>
    </td>
  );
}

/**
 * A table wider than the screen scrolls inside its own box, which a keyboard must be able to reach and a screen reader must be able
 * to name. On a wide screen nothing scrolls and the box is just the table.
 */
export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="table-scroll" tabIndex={0} role="group" aria-label={`${label}, scrolls sideways on a narrow screen`}>
      {children}
    </div>
  );
}
