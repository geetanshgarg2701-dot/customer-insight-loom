import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOUR, clampStep, isLast, progressText, stepWords } from "./tour";

const APP = join(__dirname, "..", "..", "app");

describe("the tour", () => {
  it("has four steps with different ids, each with a title and a body", () => {
    expect(TOUR).toHaveLength(4);
    expect(new Set(TOUR.map((s) => s.id)).size).toBe(4);
    for (const s of TOUR) {
      expect(s.title.trim().length).toBeGreaterThan(3);
      expect(s.body.trim().length).toBeGreaterThan(20);
    }
  });

  it("can be read in well under two minutes: at most 200 words", () => {
    // About 200 words a minute for reading leaves the other minute for the one thing to click.
    const words = TOUR.reduce((n, s) => n + stepWords(s), 0);
    expect(words).toBeLessThanOrEqual(200);
    expect(words).toBeGreaterThan(60);
  });

  it("links only to screens that exist", () => {
    for (const s of TOUR) {
      if (s.action.kind !== "link") continue;
      const route = s.action.href.replace(/^\//, "").replace(/\/$/, "");
      expect(route, s.id).not.toBe("");
      expect(existsSync(join(APP, route, "page.tsx")), `${s.id} links to /${route}, which has no page`).toBe(true);
      expect(s.action.label.trim().length).toBeGreaterThan(3);
    }
  });

  it("has one step that loads the demo ledger, and it comes before the links to the screens that use it", () => {
    const demo = TOUR.findIndex((s) => s.action.kind === "demo");
    expect(demo).toBeGreaterThanOrEqual(0);
    expect(TOUR.filter((s) => s.action.kind === "demo")).toHaveLength(1);
    const firstLink = TOUR.findIndex((s) => s.action.kind === "link");
    expect(demo).toBeLessThan(firstLink);
  });

  it("makes no promise it cannot keep about what the demo is", () => {
    // Every step that loads or draws data says it is made up, in its own words, not only somewhere else in the tour.
    for (const step of TOUR.filter((s) => s.action.kind === "demo" || s.id === "journeys")) {
      expect(`${step.title} ${step.body}`, step.id).toMatch(/made.up|synthetic/i);
    }
    expect(TOUR.map((s) => s.body).join(" ")).toMatch(/nothing (is )?uploaded|stays in (this|your) (tab|browser)/i);
  });
});

describe("moving through it", () => {
  it("keeps the step inside the list", () => {
    expect(clampStep(-3)).toBe(0);
    expect(clampStep(0)).toBe(0);
    expect(clampStep(2)).toBe(2);
    expect(clampStep(3)).toBe(3);
    expect(clampStep(99)).toBe(3);
    expect(clampStep(Number.NaN)).toBe(0);
    expect(clampStep(1.7)).toBe(1);
  });

  it("says where the person is, counting from one", () => {
    expect(progressText(0)).toBe("Step 1 of 4");
    expect(progressText(3)).toBe("Step 4 of 4");
    expect(progressText(50)).toBe("Step 4 of 4");
  });

  it("knows the last step", () => {
    expect(isLast(2)).toBe(false);
    expect(isLast(3)).toBe(true);
    expect(isLast(9)).toBe(true);
  });
});
