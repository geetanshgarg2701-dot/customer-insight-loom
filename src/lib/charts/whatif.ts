export type StageCount = { stage: string; count: number };

export type WhatIf = {
  /** The step that was changed, such as "Product to Cart". */
  step: string;
  currentRate: number;
  newRate: number;
  /** People at each stage after the change. */
  counts: StageCount[];
  /** People at the last stage, compared with now. Negative when the change makes things worse. */
  extraAtEnd: number;
  /** The extra people at the end as a share of the people there now. */
  extraShare: number;
  note: string;
};

/**
 * A planning aid for one question: if one step kept this many more percentage points of the people who reach it, how
 * many more people would reach the end? The later steps keep their current rates. This is a calculation on the
 * numbers on screen, not a forecast, and the note says what it assumes.
 */
export function whatIf(stages: readonly StageCount[], change: { fromStep: number; points: number }): WhatIf {
  if (stages.length < 2) throw new RangeError("A what if needs at least two stages.");
  if (!Number.isInteger(change.fromStep) || change.fromStep < 0 || change.fromStep > stages.length - 2) {
    throw new RangeError("That step does not exist.");
  }
  if (!Number.isFinite(change.points)) throw new RangeError("The change must be a number of percentage points.");

  const rates = stages.slice(0, -1).map((s, i) => (s.count === 0 ? 0 : stages[i + 1].count / s.count));
  const currentRate = rates[change.fromStep];
  const newRate = Math.min(1, Math.max(0, currentRate + change.points / 100));
  const counts: StageCount[] = [{ stage: stages[0].stage, count: stages[0].count }];
  for (let i = 0; i < rates.length; i++) {
    const rate = i === change.fromStep ? newRate : rates[i];
    counts.push({ stage: stages[i + 1].stage, count: counts[i].count * rate });
  }
  const before = stages[stages.length - 1].count;
  const after = counts[counts.length - 1].count;
  return {
    step: `${stages[change.fromStep].stage} to ${stages[change.fromStep + 1].stage}`,
    currentRate,
    newRate,
    counts,
    extraAtEnd: after - before,
    extraShare: before === 0 ? 0 : (after - before) / before,
    note:
      "This assumes the people gained behave like everyone already at the later steps, and that nothing else changes. " +
      "It is a planning aid on the numbers shown, not a forecast.",
  };
}

/**
 * People at each main stage, read from the flow between steps. A node name starts with its column number, such as
 * "2. Product". The first column is everyone who flows out of it, and each later column is everyone who flows in.
 */
export function stageCountsFromFlow(edges: readonly { source: string; target: string; value: number }[]): StageCount[] {
  const column = (name: string) => /^(\d)\. (.+)$/.exec(name);
  const counts = new Map<number, { stage: string; count: number }>();
  for (const e of edges) {
    const into = column(e.target);
    if (into) {
      const c = counts.get(Number(into[1])) ?? { stage: into[2], count: 0 };
      c.count += e.value;
      counts.set(Number(into[1]), c);
    }
    const from = column(e.source);
    if (from && Number(from[1]) === 1) {
      const c = counts.get(1) ?? { stage: from[2], count: 0 };
      c.count += e.value;
      counts.set(1, c);
    }
  }
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}
