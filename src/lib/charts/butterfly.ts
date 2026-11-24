import type { WaitResult } from "./rules";

/**
 * The journey as proportional bands. Each main stage is a pillar as tall as the people who reached it, and three bands leave
 * it: those who went on, which is the trunk, those who dropped off, which branch one way, and those still waiting, which branch
 * the other. The three always add up to the stage's intake, and this module refuses numbers that do not, so a picture can never
 * show parts that disagree with their whole. The counts come from the wait rule, which already counts every person once.
 */

export type StageParts = {
  stage: string;
  /** The next main stage, or null for the last stage, where nobody has anywhere left to go. */
  next: string | null;
  intake: number;
  /** Moved on to the next stage, within the wait or later. */
  wentOn: number;
  /** Had not moved on, and the wait was over at the data cutoff. */
  droppedOff: number;
  /** Had not moved on, and the wait was not over at the data cutoff. */
  stillWaiting: number;
  /** Of those who went on, how many did so through a detour such as Search. The rest went straight to the next stage. */
  via: number;
};

const whole = (n: number) => Number.isInteger(n) && n >= 0;

function check(s: StageParts): StageParts {
  if (![s.intake, s.wentOn, s.droppedOff, s.stillWaiting, s.via].every(whole)) {
    throw new RangeError(`The counts for ${s.stage} must be whole numbers from 0 up.`);
  }
  if (s.via > s.wentOn) throw new RangeError(`More people went through a detour after ${s.stage} than went on.`);
  if (s.wentOn + s.droppedOff + s.stillWaiting !== s.intake) {
    throw new RangeError(`The three parts of ${s.stage} do not add up to the people who reached it.`);
  }
  return s;
}

/** One stage, from the wait counted after it. */
export function stageFromWait(w: WaitResult): StageParts {
  if (![w.reached, w.within, w.later, w.stillWaiting, w.outlasted].every(whole)) {
    throw new RangeError(`The counts for ${w.step} must be whole numbers from 0 up.`);
  }
  return check({ stage: w.step, next: w.next, intake: w.reached, wentOn: w.within + w.later, droppedOff: w.outlasted, stillWaiting: w.stillWaiting, via: 0 });
}

/** The last stage, which only has an intake. */
export function finalStage(stage: string, intake: number): StageParts {
  if (!whole(intake)) throw new RangeError(`The count for ${stage} must be a whole number from 0 up.`);
  return { stage, next: null, intake, wentOn: 0, droppedOff: 0, stillWaiting: 0, via: 0 };
}

/** The same stage, saying how many of those who went on did so through a detour. */
export function withDetour(s: StageParts, via: number): StageParts {
  return check({ ...s, via });
}

/** A band is never thinner than this once it has anyone in it, so a small group still shows. A group of nobody shows nothing. */
export const MIN_BAND_PX = 1;

export type StageLayout = StageParts & {
  x: number;
  top: number;
  height: number;
  stillWaitingH: number;
  wentOnH: number;
  droppedH: number;
  /** The went on band is a detour part above and a direct part below, which together are exactly its thickness. */
  detourH: number;
  directH: number;
  /** Where each band leaves the pillar, down its side. */
  waitY: number;
  trunkY: number;
  dropY: number;
  detourY: number;
  directY: number;
};

export type LayoutOptions = {
  /** The height of the first pillar. Every other thickness is scaled from it, so equal counts are equal thicknesses everywhere. */
  maxHeight: number;
  /** The line every pillar is centered on. */
  centerY: number;
  columnGap: number;
  pillarWidth: number;
};

export function layoutBands(stages: readonly StageParts[], o: LayoutOptions): StageLayout[] {
  const first = stages[0]?.intake ?? 0;
  const scale = first > 0 ? o.maxHeight / first : 0;
  const px = (count: number) => (count <= 0 ? 0 : Math.max(MIN_BAND_PX, count * scale));
  return stages.map((s, i) => {
    const stillWaitingH = px(s.stillWaiting);
    const wentOnH = px(s.wentOn);
    const droppedH = px(s.droppedOff);
    // The detour part is its own share of the trunk, so the two together are the trunk's thickness whatever the scale.
    const detourH = s.wentOn > 0 ? wentOnH * (s.via / s.wentOn) : 0;
    const directH = wentOnH - detourH;
    // A final stage has no bands, so its pillar is sized by its intake. Any other is exactly its three bands.
    const height = s.next === null ? px(s.intake) : stillWaitingH + wentOnH + droppedH;
    const top = o.centerY - height / 2;
    return {
      ...s,
      x: i * o.columnGap,
      top,
      height,
      stillWaitingH,
      wentOnH,
      droppedH,
      detourH,
      directH,
      waitY: top + stillWaitingH / 2,
      trunkY: top + stillWaitingH + wentOnH / 2,
      dropY: top + stillWaitingH + wentOnH + droppedH / 2,
      detourY: top + stillWaitingH + detourH / 2,
      directY: top + stillWaitingH + detourH + directH / 2,
    };
  });
}
