"use client";

import { setManualReduce, useManualReduce } from "@/lib/app/motion";

/**
 * Turns motion off for this tab. The system setting is followed already; this is for people who have not set it, or who want it
 * off only here. It is not saved, because the app stores nothing, so it resets when the tab reloads.
 */
export function MotionSwitch() {
  const on = useManualReduce();
  return (
    <button type="button" className="motion-switch" aria-pressed={on} onClick={() => setManualReduce(!on)}>
      Reduce motion
    </button>
  );
}
