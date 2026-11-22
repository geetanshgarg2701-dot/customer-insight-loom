"use client";

import { formatSignedPoints } from "@/lib/app/format";
import { rangeSentence, rangeView } from "@/lib/app/range";

/**
 * A result's range as a picture: a number line in percentage points with zero marked, the interval as a bar that grows out
 * from the lift, and the lift as a marker. The picture adds nothing the table does not say. It is drawn so a person can see at
 * a glance whether the range clears zero. A screen reader hears the same numbers in one sentence.
 */
export function IntervalPlot({ low, high, lift, alpha }: { low: number; high: number; lift: number; alpha: number }) {
  const view = rangeView(low, high, lift);
  if (!view) return null;
  const level = Math.round((1 - alpha) * 100);
  const span = Math.max(view.highPct - view.lowPct, 0.0001);
  const origin = `${Math.min(Math.max(((view.liftPct - view.lowPct) / span) * 100, 0), 100)}%`;
  const tone = view.direction === "above" ? "above" : view.direction === "below" ? "below" : "spans";
  return (
    <figure className="range-plot" data-tone={tone}>
      <div className="range-stage" role="img" aria-label={rangeSentence(low, high, lift, level, formatSignedPoints)}>
        <div className="range-zero" style={{ left: `${view.zeroPct}%` }} aria-hidden="true" />
        <div className="range-axis" aria-hidden="true" />
        <div
          className="range-bar"
          aria-hidden="true"
          style={{ left: `${view.lowPct}%`, width: `${view.highPct - view.lowPct}%`, transformOrigin: `${origin} 50%` }}
        />
        <div className="range-lift" aria-hidden="true" style={{ left: `${view.liftPct}%` }} />
        <div className="range-ticks" aria-hidden="true">
          {view.ticks.map((t) => (
            <span key={t} style={{ left: `${view.at(t)}%` }}>
              {t > 0 ? `+${t}` : t}
            </span>
          ))}
        </div>
      </div>
      <figcaption>
        The bar is the {level} percent interval, in percentage points, and the dot is the lift. If the bar crosses the zero line, the
        result cannot rule out no effect.
      </figcaption>
    </figure>
  );
}
