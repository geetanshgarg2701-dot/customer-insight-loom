import { describe, expect, it } from "vitest";
import { HYPOTHESES, fillHypothesis, findBrackets, hypothesisById, startFrom } from "./hypotheses";

const everyText = (h: (typeof HYPOTHESES)[number]) => [h.name, h.idea, h.titleTemplate, h.hypothesisTemplate, h.primaryMetric, h.watchOut].join("\n");

describe("the library", () => {
  it("has at least six ideas, each with a different id and name", () => {
    expect(HYPOTHESES.length).toBeGreaterThanOrEqual(6);
    expect(new Set(HYPOTHESES.map((h) => h.id)).size).toBe(HYPOTHESES.length);
    expect(new Set(HYPOTHESES.map((h) => h.name)).size).toBe(HYPOTHESES.length);
  });

  it("gives every idea each field, in plain words", () => {
    for (const h of HYPOTHESES) {
      expect(h.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(h.name.trim().length, `${h.id} has no name`).toBeGreaterThanOrEqual(3);
      for (const text of [h.idea, h.titleTemplate, h.hypothesisTemplate, h.primaryMetric, h.watchOut]) {
        expect(text.trim().length, `${h.id} has an empty field`).toBeGreaterThan(8);
      }
      expect(h.titleTemplate.length).toBeLessThanOrEqual(120);
    }
  });

  it("makes every hypothesis a prediction against a holdout that could turn out wrong", () => {
    for (const h of HYPOTHESES) {
      expect(h.hypothesisTemplate, h.id).toMatch(/\bholdout\b/i);
      expect(h.hypothesisTemplate, h.id).toMatch(/\b(higher|lower|more|fewer|less)\b/i);
      expect(h.hypothesisTemplate, h.id).toMatch(/\bbecause\b/i);
    }
  });

  it("invents no number, since a figure here would read as an expected effect", () => {
    for (const h of HYPOTHESES) expect(everyText(h), h.id).not.toMatch(/\d/);
  });

  it("claims no evidence for itself", () => {
    for (const h of HYPOTHESES) {
      expect(everyText(h), h.id).not.toMatch(/\b(studies|study|research|proven|prove|guaranteed|always works|science|scientists|percent|%)\b/i);
    }
  });

  it("gives every idea a watch out note that says what makes it honest or what to avoid", () => {
    for (const h of HYPOTHESES) expect(h.watchOut, h.id).toMatch(/\b(only|never|do not|must|avoid|true|real|honest)\b/i);
  });

  it("uses a placeholder for the segment, the offer or the change, and only names it in square brackets", () => {
    for (const h of HYPOTHESES) {
      const brackets = findBrackets(h.hypothesisTemplate);
      expect(brackets.length, h.id).toBeGreaterThanOrEqual(2);
      for (const b of brackets) expect(b, h.id).toMatch(/^[a-z][a-z ]{2,40}$/);
      // Every placeholder in the title is also in the hypothesis, so filling the hypothesis fills the title.
      for (const b of findBrackets(h.titleTemplate)) expect(brackets, h.id).toContain(b);
    }
  });
});

describe("finding the brackets", () => {
  it("lists each placeholder once, in order, without the brackets", () => {
    expect(findBrackets("Send [a] to [b], then [a] again and [c d].")).toEqual(["a", "b", "c d"]);
  });
  it("finds none in plain text", () => {
    expect(findBrackets("nothing to fill")).toEqual([]);
    expect(findBrackets("an empty [] pair and an open [ bracket")).toEqual([]);
  });
});

describe("starting a draft from an idea", () => {
  const h = hypothesisById("scarcity")!;

  it("finds an idea by id and returns nothing for an unknown one", () => {
    expect(h.name).toBe("Scarcity");
    expect(hypothesisById("no-such-idea")).toBeUndefined();
  });

  it("gives the title and hypothesis with the brackets still in place, for the person to fill", () => {
    const s = startFrom(h);
    expect(s.title).toBe(h.titleTemplate);
    expect(s.hypothesis).toBe(h.hypothesisTemplate);
    expect(s.brackets).toEqual(findBrackets(h.hypothesisTemplate));
  });

  it("fills the brackets from the values given and reports what is still missing", () => {
    const [first, ...rest] = findBrackets(h.hypothesisTemplate);
    const part = fillHypothesis(h.hypothesisTemplate, { [first]: "new customers" });
    expect(part.text).toContain("new customers");
    expect(part.text).not.toContain(`[${first}]`);
    expect(part.missing).toEqual(rest);
    const all = fillHypothesis(h.hypothesisTemplate, Object.fromEntries([first, ...rest].map((k) => [k, `value for ${k}`])));
    expect(all.missing).toEqual([]);
    expect(findBrackets(all.text)).toEqual([]);
  });

  it("treats a blank value as missing, trims the rest, and cuts a value to 80 characters", () => {
    const [first] = findBrackets(h.hypothesisTemplate);
    expect(fillHypothesis(h.hypothesisTemplate, { [first]: "   " }).missing).toContain(first);
    expect(fillHypothesis("a [x] b", { x: "  hi  " }).text).toBe("a hi b");
    expect(fillHypothesis("a [x] b", { x: "y".repeat(200) }).text).toBe(`a ${"y".repeat(80)} b`);
  });

  it("will not let a value bring brackets of its own, so a fill cannot add a new placeholder", () => {
    expect(fillHypothesis("a [x] b", { x: "[other]" }).text).toBe("a other b");
    expect(fillHypothesis("a [x] [x] b", { x: "v" }).text).toBe("a v v b");
  });
});
