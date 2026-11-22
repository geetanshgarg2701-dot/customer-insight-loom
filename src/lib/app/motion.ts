"use client";

import { useSyncExternalStore } from "react";

/**
 * Motion is reduced when the system asks for it or when the person turns on the Reduce motion switch. The switch lives on the
 * page only, as an attribute on the root element, so nothing is stored in the browser and it resets when the tab reloads.
 */
const QUERY = "(prefers-reduced-motion: reduce)";
const EVENT = "motionchange";

export function motionReduced(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(QUERY).matches || document.documentElement.dataset.motion === "reduce";
}

/** Turns the manual switch on or off and tells everything that is listening. */
export function setManualReduce(on: boolean): void {
  if (on) document.documentElement.dataset.motion = "reduce";
  else delete document.documentElement.dataset.motion;
  window.dispatchEvent(new Event(EVENT));
}

export function manualReduce(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.motion === "reduce";
}

function subscribe(callback: () => void): () => void {
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", callback);
  window.addEventListener(EVENT, callback);
  return () => {
    query.removeEventListener("change", callback);
    window.removeEventListener(EVENT, callback);
  };
}

/** True when motion should be off, following the system setting and the switch live. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, motionReduced, () => false);
}

/** True when the Reduce motion switch is on, for the switch's own pressed state. */
export function useManualReduce(): boolean {
  return useSyncExternalStore(subscribe, manualReduce, () => false);
}
