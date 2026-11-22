import type { FunnelStage } from "./pipeline";

/**
 * The number tiles at the top of the pipeline screen, worked out from the same funnel and stalled count as the charts,
 * so a tile can never disagree with them. Shares are of the deals in the current selection.
 */
export type PipelineTiles = {
  deals: number;
  /** The share that reached the last stage. Null when no deal is selected. */
  won: number | null;
  /** The step where the smallest share of deals went on, or null when no deal is selected. A tie goes to the earlier step. */
  hardestStep: { from: string; to: string; goOn: number } | null;
  stalled: number;
  stalledShare: number | null;
};

export function pipelineTiles(funnel: readonly FunnelStage[], stalled: number): PipelineTiles {
  const deals = funnel[0]?.count ?? 0;
  if (deals === 0) return { deals: 0, won: null, hardestStep: null, stalled, stalledShare: null };
  const last = funnel[funnel.length - 1];
  let hardest: PipelineTiles["hardestStep"] = null;
  for (let i = 1; i < funnel.length; i++) {
    const goOn = funnel[i - 1].count === 0 ? 0 : funnel[i].count / funnel[i - 1].count;
    if (hardest === null || goOn < hardest.goOn) hardest = { from: funnel[i - 1].stage, to: funnel[i].stage, goOn };
  }
  return { deals, won: last.count / deals, hardestStep: hardest, stalled, stalledShare: stalled / deals };
}
