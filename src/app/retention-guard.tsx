"use client";

import { useEffect, useRef, useState } from "react";
import { deleteBrowserData } from "@/lib/duckdb/client";
import { leftText } from "@/lib/usage/retention";
import { retentionStore } from "@/lib/usage/retention-store";
import { useRetention } from "@/lib/usage/use-retention";

const ACTIVITY = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

/**
 * Runs the retention timer for every screen. It watches for activity while the timer is on, warns in the last minute,
 * and at the deadline deletes everything in the tab and reloads it with a note, the way the delete control does.
 */
export function RetentionGuard() {
  const { state, status } = useRetention();
  const fired = useRef(false);
  const [failed, setFailed] = useState<string | null>(null);
  const on = state !== null;

  useEffect(() => {
    if (!on) return;
    const touch = () => retentionStore.touch(Date.now());
    for (const e of ACTIVITY) window.addEventListener(e, touch, { passive: true });
    return () => {
      for (const e of ACTIVITY) window.removeEventListener(e, touch);
    };
  }, [on]);

  useEffect(() => {
    if (status.phase !== "expired" || fired.current) return;
    fired.current = true;
    void (async () => {
      try {
        await deleteBrowserData();
        window.location.hash = "#expired";
        window.location.reload();
      } catch (e) {
        setFailed(e instanceof Error ? e.message : "Something went wrong.");
      }
    })();
  }, [status.phase]);

  if (failed) {
    return (
      <div role="alert" className="retention-warning">
        <p>The timer ran out, but the data could not be deleted: {failed} Use Delete everything on the Your data screen.</p>
      </div>
    );
  }
  if (status.phase !== "warning") return null;
  return (
    <div role="alert" className="retention-warning">
      <p>
        This tab has been inactive, so everything it holds will be deleted in under a minute. Export the ledger first if you
        want to keep it, or press the button to keep your data.
      </p>
      <p aria-hidden="true">{leftText(status.secondsLeft)} left</p>
      <button type="button" onClick={() => retentionStore.touch(Date.now())}>
        Keep my data
      </button>
    </div>
  );
}
