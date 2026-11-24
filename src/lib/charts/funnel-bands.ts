/**
 * The geometry of the pipeline stage funnel drawn as bands. Pure arithmetic, so it can be tested without a browser.
 * Every thickness is a count times one scale that starts at zero, so equal counts are equal thicknesses and nothing is truncated.
 * Pillars share one top line. The part of a pillar that reached the next stage is its top slice and runs straight across to the
 * next pillar. The part that did not is its bottom slice and curves down into a line of text.
 */

export type FunnelInput = { stage: string; count: number };

export type FunnelLayout = {
  stage: string;
  count: number;
  /** The next stage's name, or null for the last stage. */
  next: string | null;
  /** How many of this stage's deals also reached the next stage. Never more than this stage's own count. */
  wentOn: number;
  /** How many of this stage's deals did not reach the next stage. This includes deals still sitting at this stage. */
  didNot: number;
  x: number;
  top: number;
  height: number;
  wentH: number;
  didNotH: number;
};

export type FunnelOptions = { maxHeight: number; top: number; columnGap: number };

/** The pixels for one deal. It is zero when nobody reached the first stage, and then nothing is drawn. */
export function funnelScale(stages: readonly FunnelInput[], maxHeight: number): number {
  const first = stages[0]?.count ?? 0;
  return first > 0 ? maxHeight / first : 0;
}

export function layoutFunnel(stages: readonly FunnelInput[], o: FunnelOptions): FunnelLayout[] {
  const scale = funnelScale(stages, o.maxHeight);
  return stages.map((s, i) => {
    const next = stages[i + 1] ?? null;
    // The funnel counts come from separate queries, so a later stage can read higher than the one before it. It is held to the
    // stage before so the two slices always add up to the pillar.
    const wentOn = next ? Math.min(Math.max(next.count, 0), s.count) : 0;
    const didNot = next ? s.count - wentOn : 0;
    const height = Math.max(s.count, 0) * scale;
    const wentH = wentOn * scale;
    return { stage: s.stage, count: s.count, next: next?.stage ?? null, wentOn, didNot, x: i * o.columnGap, top: o.top, height, wentH, didNotH: next ? height - wentH : 0 };
  });
}

/** A filled band between two edges, each a top and a bottom, drawn as a smooth curve. */
export function bandPath(x0: number, y0Top: number, y0Bottom: number, x1: number, y1Top: number, y1Bottom: number): string {
  const mid = (x0 + x1) / 2;
  const f = (v: number) => Number(v.toFixed(2));
  return [
    `M ${f(x0)} ${f(y0Top)}`,
    `C ${f(mid)} ${f(y0Top)} ${f(mid)} ${f(y1Top)} ${f(x1)} ${f(y1Top)}`,
    `L ${f(x1)} ${f(y1Bottom)}`,
    `C ${f(mid)} ${f(y1Bottom)} ${f(mid)} ${f(y0Bottom)} ${f(x0)} ${f(y0Bottom)}`,
    "Z",
  ].join(" ");
}
