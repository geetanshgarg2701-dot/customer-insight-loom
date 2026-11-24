import { JOURNEY_STEPS, syntheticJourneys } from "../demo/journeys";

/** The same customers and seed the Journeys screen loads, so the two screens show the same counts. */
export const HERO_ROWS = 100_000;
export const HERO_SEED = 11;

export type FunnelStep = { name: string; count: number };

let cached: FunnelStep[] | null = null;

/** How many synthetic customers reached each main step. Worked out once, when the page is built. */
export function heroFunnel(): FunnelStep[] {
  if (cached === null) {
    const rows = syntheticJourneys(HERO_ROWS, HERO_SEED);
    cached = JOURNEY_STEPS.map((name, i) => ({ name, count: rows.filter((r) => r.steps[i] !== null).length }));
  }
  return cached;
}

/**
 * The outline of the funnel as an SVG path in a box. Each step is a flat stretch as tall as its share of the first step, and a
 * smooth curve joins one stretch to the next.
 */
export function funnelPath(counts: readonly number[], width: number, height: number): string {
  const top = counts[0];
  if (counts.length === 0 || !(top > 0)) return "";
  const col = width / counts.length;
  const y = (c: number) => Number((height - (c / top) * height).toFixed(2));
  const x = (v: number) => Number(v.toFixed(2));
  let d = `M0 ${height} L0 ${y(counts[0])} L${x(col * 0.7)} ${y(counts[0])}`;
  for (let i = 1; i < counts.length; i++) {
    const from = col * (i - 0.3);
    const to = col * (i + 0.3);
    const mid = col * i;
    d += ` C${x(mid)} ${y(counts[i - 1])} ${x(mid)} ${y(counts[i])} ${x(to)} ${y(counts[i])}`;
    d += ` L${x(i === counts.length - 1 ? width : from + col)} ${y(counts[i])}`;
  }
  return `${d} L${width} ${height} Z`;
}

/** One sentence with every count, for a screen reader. */
export function funnelSentence(steps: readonly FunnelStep[]): string {
  const parts = steps.slice(1).map((s) => `${s.count.toLocaleString("en-US")} reached ${s.name}`);
  return `Synthetic example. Of ${steps[0].count.toLocaleString("en-US")} made-up customers, ${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}.`;
}
