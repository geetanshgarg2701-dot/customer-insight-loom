import { startRetention, touchRetention, type RetentionState } from "./retention";

/**
 * The one retention timer for the page, held in memory. The Your data screen sets it and the guard in the page layout
 * runs it, so it keeps going as the person moves between screens. It is not stored: a reload empties the tab anyway.
 */
let state: RetentionState = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Activity closer together than this does not move the deadline again, so a stream of mouse moves costs nothing. */
const MIN_STEP_MS = 1000;

export const retentionStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get(): RetentionState {
    return state;
  },
  start(minutes: number, now: number): void {
    state = startRetention(minutes, now);
    emit();
  },
  stop(): void {
    if (state === null) return;
    state = null;
    emit();
  },
  touch(now: number): void {
    if (state && now - state.lastActivity < MIN_STEP_MS) return;
    const next = touchRetention(state, now);
    if (next !== state) {
      state = next;
      emit();
    }
  },
};
