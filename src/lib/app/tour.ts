/**
 * The guided first run, plan feature 1: a short tour a new visitor can take in under two minutes, and skip at any time.
 * The steps are plain data, so a test can hold them to the length, and check that every link goes to a screen that exists.
 *
 * It opens only from its button, so it never covers the page on arrival, and it can be closed at once.
 */

export type TourAction =
  | { kind: "none" }
  | { kind: "demo" }
  | { kind: "link"; href: string; label: string };

export type TourStep = { id: string; title: string; body: string; action: TourAction };

export const TOUR: readonly TourStep[] = [
  {
    id: "what",
    title: "Write the bet down first",
    body:
      "This app keeps a ledger of email experiments. You record what you expect before you send, hold some customers back as a control group, and read the result once, with the uncertainty shown. Everything runs in this tab, and nothing is uploaded.",
    action: { kind: "none" },
  },
  {
    id: "demo",
    title: "Load the demo ledger",
    body:
      "Four made-up experiments, in different states, show the whole path from a draft to a locked result. They are synthetic, so no real customer is involved.",
    action: { kind: "demo" },
  },
  {
    id: "journeys",
    title: "See where customers leave",
    body:
      "Journeys draws 100,000 made-up customers and shows where they drop off. Click a bar and every other chart follows.",
    action: { kind: "link", href: "/journeys", label: "Open Journeys" },
  },
  {
    id: "email",
    title: "Check an email before it goes out",
    body:
      "The Email check tests a draft against US email law and the Gmail and Yahoo sender rules, and shows the source of each rule. You have finished the tour. Reload the page and everything in this tab is gone.",
    action: { kind: "link", href: "/compliance", label: "Open the Email check" },
  },
];

export const TOUR_LENGTH = TOUR.length;

/** Keeps a step number inside the list. A bad number becomes the first step. */
export function clampStep(i: number): number {
  if (!Number.isFinite(i)) return 0;
  return Math.min(TOUR_LENGTH - 1, Math.max(0, Math.floor(i)));
}

export function progressText(i: number): string {
  return `Step ${clampStep(i) + 1} of ${TOUR_LENGTH}`;
}

export function isLast(i: number): boolean {
  return clampStep(i) === TOUR_LENGTH - 1;
}

/** The words a person reads on one step, for holding the whole tour to its length. */
export function stepWords(step: TourStep): number {
  return `${step.title} ${step.body}`.split(/\s+/).filter(Boolean).length;
}
