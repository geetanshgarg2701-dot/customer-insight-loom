"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { retentionStatus, type RetentionState, type RetentionStatus } from "./retention";
import { retentionStore } from "./retention-store";

/**
 * The timer and what it says right now, ticking once a second while it runs. The time is read in an effect, never while
 * rendering, so the render stays the same for the same state.
 */
export function useRetention(): { state: RetentionState; status: RetentionStatus } {
  const state = useSyncExternalStore(retentionStore.subscribe, retentionStore.get, () => null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!state) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [state]);
  const status: RetentionStatus = state && now > 0 ? retentionStatus(state, now) : { phase: "off" };
  return { state, status };
}
