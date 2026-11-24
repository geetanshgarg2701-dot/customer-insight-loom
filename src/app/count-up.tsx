"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "@/lib/app/motion";

/**
 * A number that counts up from zero the first time it appears, once per page load, and never again. A filter that changes the
 * number later shows the new number at once. The real number is always in the page text, so a screen reader, a search and a test
 * read it straight away. While it counts, the real text is made see-through and the changing number is drawn over it from an
 * attribute. Off under Reduce motion, and it does not loop.
 */

/** The count lasts this long, in milliseconds. The motion rules allow 600 at most. */
export const COUNT_MS = 450;

/** What has already counted up in this page load. */
const played = new Set<string>();

export function CountUp({ id, value }: { id: string; value: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (played.has(id) || value <= 0) return;
    if (reduced) {
      played.add(id);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_MS);
      if (t >= 1) {
        played.add(id);
        setShown(null);
        return;
      }
      setShown(Math.round(value * (1 - (1 - t) ** 3)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [id, value, reduced]);
  return (
    <span className="cu" data-counting={shown === null ? undefined : "true"} data-shown={shown === null ? undefined : shown.toLocaleString("en-US")}>
      {value.toLocaleString("en-US")}
    </span>
  );
}
