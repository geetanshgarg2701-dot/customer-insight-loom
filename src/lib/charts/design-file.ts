import { DESIGNED_JOURNEY, wouldCreateCycle } from "./designed";
import { INACTIVE_CHOICES, WAIT_CHOICES } from "./rules";

/**
 * A saved journey design: the connections someone sketched, the wait and the exit rule. It is a small file the person
 * downloads and opens again, so the app keeps nothing in the browser. It holds no customer data, no email and no count.
 */
export const DESIGN_FILE_KIND = "customer-insight-loom-journey-design";
export const DESIGN_FILE_VERSION = 1;

/** A design file is a few hundred bytes. A larger file is not one of ours. */
export const MAX_DESIGN_FILE_CHARS = 20_000;
const MAX_SKETCH = 60;
const MAIN_COUNT = DESIGNED_JOURNEY.nodes.filter((n) => n.mainIndex !== null).length;

export type JourneyDesign = {
  /** Index of the main step the wait follows. */
  waitStep: number;
  waitDays: number;
  inactiveDays: number;
  /** Sketched connections between known steps. Whether one makes a loop is worked out again when the design is opened. */
  sketch: { from: string; to: string }[];
};

export function designToFile(design: JourneyDesign, savedAt: string): string {
  return JSON.stringify(
    {
      kind: DESIGN_FILE_KIND,
      version: DESIGN_FILE_VERSION,
      saved_at: savedAt,
      wait: { after_step: design.waitStep, days: design.waitDays },
      inactive_days: design.inactiveDays,
      sketch: design.sketch.map((s) => ({ from: s.from, to: s.to })),
    },
    null,
    2,
  );
}

const refuse = (why: string) => new RangeError(`This is not a journey design this app saved: ${why}`);

/**
 * Reads a saved design. Anything that is not exactly the shape the app writes is refused with a plain reason, so a wrong
 * file never half applies. Step names are checked against the canvas, and loops are not taken from the file.
 */
export function readDesignFile(text: string): JourneyDesign {
  if (text.length > MAX_DESIGN_FILE_CHARS) throw refuse("the file is too large.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw refuse("it is not readable as a design file.");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw refuse("it is not a design file.");
  const r = raw as Record<string, unknown>;
  if (r.kind !== DESIGN_FILE_KIND) throw refuse("it is not a journey design file.");
  if (r.version !== DESIGN_FILE_VERSION) throw refuse("it was saved by a version this app does not read.");

  const wait = r.wait as Record<string, unknown> | null | undefined;
  if (!wait || typeof wait !== "object") throw refuse("the wait is missing.");
  const step = wait.after_step;
  if (typeof step !== "number" || !Number.isInteger(step) || step < 0 || step > MAIN_COUNT - 2) throw refuse("the wait follows a step that is not on the canvas.");
  const days = wait.days;
  if (!WAIT_CHOICES.some((d) => d === days)) throw refuse(`the wait length must be ${WAIT_CHOICES.join(", ")} days.`);
  const inactive = r.inactive_days;
  if (!INACTIVE_CHOICES.some((d) => d === inactive)) throw refuse(`the inactivity rule must be ${INACTIVE_CHOICES.join(", ")} days.`);

  if (!Array.isArray(r.sketch)) throw refuse("the sketch is missing.");
  if (r.sketch.length > MAX_SKETCH) throw refuse("the sketch has too many connections.");
  const ids = new Set(DESIGNED_JOURNEY.nodes.map((n) => n.id));
  const taken = new Set(DESIGNED_JOURNEY.edges.map((e) => `${e.from}>${e.to}`));
  const sketch: { from: string; to: string }[] = [];
  for (const item of r.sketch) {
    const s = item as Record<string, unknown> | null;
    if (!s || typeof s.from !== "string" || typeof s.to !== "string") throw refuse("a connection is not in the expected shape.");
    if (!ids.has(s.from) || !ids.has(s.to)) throw refuse("a connection names a step that is not on the canvas.");
    const key = `${s.from}>${s.to}`;
    if (taken.has(key)) throw refuse(`${s.from} to ${s.to} is repeated or already on the canvas.`);
    taken.add(key);
    sketch.push({ from: s.from, to: s.to });
  }
  return { waitStep: step, waitDays: days as number, inactiveDays: inactive as number, sketch };
}

/** The sketch with each connection marked as a loop or not, in order, as the canvas draws it. */
export function markLoops(sketch: readonly { from: string; to: string }[]): { from: string; to: string; loop: boolean }[] {
  const all: { from: string; to: string }[] = [...DESIGNED_JOURNEY.edges];
  return sketch.map((s) => {
    const loop = wouldCreateCycle(all, s.from, s.to);
    all.push({ from: s.from, to: s.to });
    return { ...s, loop };
  });
}
