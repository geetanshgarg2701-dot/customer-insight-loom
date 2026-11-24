import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The motion rules from docs/2026-11-21-visual-spec.md, held against the stylesheet itself. Motion is purposeful and short,
 * moves only opacity and transform, loops only as a loading indicator, and is off under reduced motion.
 */
const CSS = readFileSync("src/app/globals.css", "utf8");

type Declaration = { property: string; value: string; context: string[] };

/** Every declaration, with the at-rules and selectors it sits inside, found by walking the braces. */
function declarations(css: string): Declaration[] {
  const out: Declaration[] = [];
  const stack: string[] = [];
  let buffer = "";
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (ch === "{") {
      stack.push(buffer.trim().replace(/\s+/g, " "));
      buffer = "";
    } else if (ch === "}") {
      const last = buffer.trim();
      if (last.includes(":")) {
        const [property, ...rest] = last.split(":");
        out.push({ property: property.trim(), value: rest.join(":").trim(), context: [...stack] });
      }
      stack.pop();
      buffer = "";
    } else if (ch === ";") {
      const [property, ...rest] = buffer.split(":");
      if (rest.length > 0) out.push({ property: property.trim(), value: rest.join(":").trim(), context: [...stack] });
      buffer = "";
    } else buffer += ch;
  }
  return out;
}

const DECLARATIONS = declarations(CSS);
const seconds = (token: string) => (token.endsWith("ms") ? parseFloat(token) / 1000 : parseFloat(token));
const times = (value: string) => value.split(/[\s,]+/).filter((t) => /^[\d.]+m?s$/.test(t)).map(seconds);
const animations = DECLARATIONS.filter((d) => d.property === "animation" && d.value !== "none !important" && d.value !== "none");
const LOADING = /^sk-/;

describe("the stylesheet's motion", () => {
  it("finds the animations it is holding to the rules", () => {
    expect(animations.length).toBeGreaterThan(8);
  });

  it.each(animations.map((a) => [a.value.split(" ")[0], a] as const))("%s is short, and only a loading indicator loops", (name, a) => {
    const [duration, delay = 0] = times(a.value);
    if (a.value.includes("infinite")) {
      expect(name, "only a loading indicator may loop").toMatch(LOADING);
      expect(duration).toBeGreaterThanOrEqual(1.5);
    } else {
      expect(duration, "600 milliseconds at most").toBeLessThanOrEqual(0.6);
      expect(delay, "a wait of 300 milliseconds at most").toBeLessThanOrEqual(0.3);
    }
  });

  it("starts every animation only where the system has not asked for less motion", () => {
    for (const a of animations) {
      expect(a.context.some((c) => c.startsWith("@media (prefers-reduced-motion: no-preference)")), a.value).toBe(true);
    }
  });

  it("keeps every transition to a third of a second, and none on layout", () => {
    for (const d of DECLARATIONS.filter((x) => x.property === "transition" && x.value !== "none !important")) {
      for (const t of times(d.value)) expect(t, d.value).toBeLessThanOrEqual(0.32);
      expect(d.value, d.value).not.toMatch(/\b(width|height|top|left|right|bottom|margin|padding)\b/);
    }
  });

  it("moves only opacity and transform, apart from the loading shimmer and the menu chevron", () => {
    const frames = DECLARATIONS.filter((d) => d.context.some((c) => c.startsWith("@keyframes ")));
    expect(frames.length).toBeGreaterThan(8);
    for (const d of frames) {
      const name = d.context.find((c) => c.startsWith("@keyframes "))!.replace("@keyframes ", "");
      if (LOADING.test(name)) continue;
      expect(["opacity", "transform"], `${name} animates ${d.property}`).toContain(d.property);
    }
  });

  it("has no bounce, which would overshoot and misstate a value", () => {
    for (const d of DECLARATIONS.filter((x) => /animation|transition/.test(x.property))) expect(d.value).not.toMatch(/bounce|elastic|back|cubic-bezier\([^)]*-/);
  });

  it("turns everything off under the Reduce motion switch", () => {
    const off = DECLARATIONS.filter((d) => d.context.some((c) => c.includes('html[data-motion="reduce"]')) && /animation|transition/.test(d.property));
    expect(off.map((d) => `${d.property}: ${d.value}`).sort()).toEqual(["animation: none !important", "transition: none !important"]);
  });
});
