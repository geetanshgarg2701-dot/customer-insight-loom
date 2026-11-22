import { describe, expect, it } from "vitest";
import { DESIGNED_JOURNEY } from "./designed";
import { designToFile, markLoops, readDesignFile, type JourneyDesign } from "./design-file";

const ids = DESIGNED_JOURNEY.nodes.map((n) => n.id);
const design: JourneyDesign = { waitStep: 2, waitDays: 3, inactiveDays: 14, sketch: [{ from: ids[ids.length - 1], to: ids[0] }] };
const good = () => JSON.parse(designToFile(design, "2026-11-21T10:00:00.000Z"));
const asText = (o: unknown) => JSON.stringify(o);

describe("a saved journey design", () => {
  it("reads back exactly what was saved", () => {
    expect(readDesignFile(designToFile(design, "2026-11-21T10:00:00.000Z"))).toEqual(design);
  });
  it("round trips an empty sketch and the largest choices", () => {
    const d: JourneyDesign = { waitStep: 0, waitDays: 7, inactiveDays: 90, sketch: [] };
    expect(readDesignFile(designToFile(d, "x"))).toEqual(d);
  });
  it("holds only the design: no email, no count, no customer value", () => {
    const text = designToFile(design, "2026-11-21T10:00:00.000Z");
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["inactive_days", "kind", "saved_at", "sketch", "version", "wait"]);
    expect(text).not.toMatch(/@/);
  });

  it.each([
    ["not JSON", "{nope"],
    ["an array", "[]"],
    ["null", "null"],
    ["another kind of file", asText({ ...good(), kind: "something-else" })],
    ["another version", asText({ ...good(), version: 2 })],
    ["a missing wait", asText({ ...good(), wait: undefined })],
    ["a wait after the last step", asText({ ...good(), wait: { after_step: 99, days: 3 } })],
    ["a negative wait step", asText({ ...good(), wait: { after_step: -1, days: 3 } })],
    ["a fractional wait step", asText({ ...good(), wait: { after_step: 1.5, days: 3 } })],
    ["a wait length that is not offered", asText({ ...good(), wait: { after_step: 1, days: 5 } })],
    ["an inactivity rule that is not offered", asText({ ...good(), inactive_days: 10 })],
    ["a sketch that is not a list", asText({ ...good(), sketch: "x" })],
    ["a connection to an unknown step", asText({ ...good(), sketch: [{ from: ids[0], to: "Nowhere" }] })],
    ["a connection with a number", asText({ ...good(), sketch: [{ from: 1, to: 2 }] })],
    ["a connection already on the canvas", asText({ ...good(), sketch: [{ from: DESIGNED_JOURNEY.edges[0].from, to: DESIGNED_JOURNEY.edges[0].to }] })],
    ["a repeated sketched connection", asText({ ...good(), sketch: [{ from: ids[3], to: ids[0] }, { from: ids[3], to: ids[0] }] })],
    ["too many connections", asText({ ...good(), sketch: Array.from({ length: 61 }, () => ({ from: ids[0], to: ids[1] })) })],
  ])("refuses %s, with a plain reason, so nothing half applies", (_, text) => {
    expect(() => readDesignFile(text)).toThrow(RangeError);
    expect(() => readDesignFile(text)).toThrow(/not a journey design this app saved/);
  });

  it("allows a wait after the third main step and refuses one after the last, which has no step after it", () => {
    expect(readDesignFile(asText({ ...good(), wait: { after_step: 2, days: 3 } })).waitStep).toBe(2);
    expect(() => readDesignFile(asText({ ...good(), wait: { after_step: 3, days: 3 } }))).toThrow(RangeError);
  });

  it("refuses a file that is too large before reading it", () => {
    expect(() => readDesignFile(" ".repeat(20_001))).toThrow(/too large/);
  });

  it("works out loops again, and does not trust a loop flag in the file", () => {
    const first = ids.find((i) => DESIGNED_JOURNEY.nodes.find((n) => n.id === i)?.mainIndex === 0)!;
    const last = ids.find((i) => DESIGNED_JOURNEY.nodes.find((n) => n.id === i)?.mainIndex === 3)!;
    const text = asText({ ...good(), sketch: [{ from: last, to: first, loop: false }, { from: first, to: "Cart" }] });
    const read = readDesignFile(text);
    expect(read.sketch[0]).toEqual({ from: last, to: first });
    expect(markLoops(read.sketch)[0].loop).toBe(true);
  });
});
