/**
 * The data retention timer, plan feature 8. The delete everything control already empties the tab on request. This adds a
 * timer a person can turn on, so a tab left open on a shared computer clears itself after a stretch of inactivity.
 *
 * It is off until someone turns it on, because deleting a person's work without being asked would be worse than not
 * deleting it. The deadline is a wall clock time, not a count of ticks, so a tab that was asleep or in the background wakes
 * up knowing the time has passed, and a clock set back cannot stretch it. Nothing here is stored: the timer lives in the
 * page's memory, and a reload empties the tab anyway.
 *
 * This file is pure. The screen that runs it passes in the time.
 */

export const RETENTION_MINUTES = [15, 30, 60, 120] as const;
/** The last stretch before deletion, when the person is told and can keep their data. */
export const WARN_SECONDS = 60;

export type RetentionState = { minutes: number; lastActivity: number } | null;
export type RetentionStatus =
  | { phase: "off" }
  | { phase: "counting" | "warning" | "expired"; secondsLeft: number };

export function startRetention(minutes: number, now: number): NonNullable<RetentionState> {
  if (!(RETENTION_MINUTES as readonly number[]).includes(minutes)) {
    throw new RangeError(`Choose ${RETENTION_MINUTES.join(", ")} minutes.`);
  }
  if (!Number.isFinite(now)) throw new RangeError("The time must be a number.");
  return { minutes, lastActivity: now };
}

export function retentionStatus(state: RetentionState, now: number): RetentionStatus {
  if (!state) return { phase: "off" };
  // A clock set back would make the time since the last activity negative. Count from the last activity at the earliest.
  const since = Math.max(0, now - state.lastActivity);
  const left = state.minutes * 60_000 - since;
  if (left <= 0) return { phase: "expired", secondsLeft: 0 };
  const secondsLeft = Math.ceil(left / 1000);
  return { phase: secondsLeft <= WARN_SECONDS ? "warning" : "counting", secondsLeft };
}

/**
 * Activity moves the deadline. A timer that has already run out is not brought back, because by then the data is being
 * deleted and a late mouse move must not cancel it.
 */
export function touchRetention(state: RetentionState, now: number): RetentionState {
  if (!state) return null;
  if (retentionStatus(state, now).phase === "expired") return state;
  if (now <= state.lastActivity) return state;
  return { ...state, lastActivity: now };
}

/** The time left in words: whole minutes, rounded up, until the last minute, then seconds. */
export function leftText(secondsLeft: number): string {
  if (secondsLeft > WARN_SECONDS) return `${Math.ceil(secondsLeft / 60)} minutes`;
  return `${secondsLeft} ${secondsLeft === 1 ? "second" : "seconds"}`;
}
