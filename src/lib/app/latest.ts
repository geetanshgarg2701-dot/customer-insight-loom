/**
 * Keeps the journey views from queuing stale work. Every filter click starts a new cycle, and the lower views refresh one
 * after another. If a newer click arrives while an older cycle is still going, the older cycle stops before its next
 * query, so the single DuckDB worker is never kept busy answering for a selection nobody is looking at.
 */
export type Cycle = { start(): number; isCurrent(id: number): boolean };

export function createCycle(): Cycle {
  let current = 0;
  return {
    start: () => ++current,
    isCurrent: (id) => id === current,
  };
}

/** Runs the tasks in order, and stops before the next one as soon as a newer cycle has started. Errors reach the caller. */
export async function runWhileCurrent(cycle: Cycle, id: number, tasks: readonly (() => Promise<void>)[]): Promise<void> {
  for (const task of tasks) {
    if (!cycle.isCurrent(id)) return;
    await task();
  }
}
