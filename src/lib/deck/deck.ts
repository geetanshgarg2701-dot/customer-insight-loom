/**
 * The decision deck, plan M9: one chosen test, its result and its caveats, optionally with the evidence chain that led
 * to it. This file builds the slides as plain data, so every number can be checked without opening a file. pptx.ts turns
 * that data into a .pptx. Every figure comes from the ledger entry and is formatted by the same functions the screens
 * use, so the deck cannot say something the entry does not.
 *
 * Text here follows the app's style: no dashes used as punctuation and no parentheses.
 */
import { formatCount, formatPercent, formatPoints, formatSignedPoints } from "../app/format";
import { describeVerdict } from "../app/verdict";
import type { ChainStep } from "../insights/evidence";
import { correctionLine } from "../ledger/correction";
import type { CorrectionMethod } from "../ledger/ledger";

export type DeckEntry = {
  title: string;
  hypothesis: string;
  status: string;
  entryType: "confirmatory" | "exploratory" | null;
  frameworkTag: string | null;
  registeredAt: string | null;
  launchedAt: string | null;
  design: unknown;
  result: unknown;
  comparisonsCount: number | null;
  correctionMethod: CorrectionMethod | null;
  synthetic: boolean;
  provenance: "local" | "imported";
};

export type DeckSlide = {
  kind: "title" | "question" | "chain" | "design" | "result" | "caveats";
  title: string;
  lines?: string[];
  table?: { header: string[]; rows: string[][] };
  chart?: { title: string; labels: string[]; values: number[] };
};
export type DeckModel = { fileName: string; slides: DeckSlide[] };

export type StoredResult = {
  lift: number;
  interval_low: number;
  interval_high: number;
  significant: boolean;
  alpha: number;
  p_value: number;
  treatment_rate: number;
  control_rate: number;
  sample_sizes: { treatment: number; control: number };
  engine_version: string | null;
  method: string | null;
};

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Reads a stored result. Refuses a shape that is not the ledger's, so a wrong number is never printed. */
export function readResult(raw: unknown): StoredResult | null {
  if (raw === null || raw === undefined) return null;
  const r = raw as Record<string, unknown>;
  const sizes = r.sample_sizes as Record<string, unknown> | null | undefined;
  if (
    typeof raw !== "object" ||
    !num(r.lift) ||
    !num(r.interval_low) ||
    !num(r.interval_high) ||
    typeof r.significant !== "boolean" ||
    !num(r.alpha) ||
    !num(r.p_value) ||
    !num(r.treatment_rate) ||
    !num(r.control_rate) ||
    !sizes ||
    !num(sizes.treatment) ||
    !num(sizes.control)
  ) {
    throw new RangeError("The stored result is not in the shape the ledger writes, so no deck was made from it.");
  }
  return {
    lift: r.lift,
    interval_low: r.interval_low,
    interval_high: r.interval_high,
    significant: r.significant,
    alpha: r.alpha,
    p_value: r.p_value,
    treatment_rate: r.treatment_rate,
    control_rate: r.control_rate,
    sample_sizes: { treatment: sizes.treatment, control: sizes.control },
    engine_version: typeof r.engine_version === "string" ? r.engine_version : null,
    method: typeof r.method === "string" ? r.method : null,
  };
}

/** A file name from the title and the date, with nothing that could break a path. */
export function deckFileName(title: string, generatedAt: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `decision-deck-${slug || "test"}-${generatedAt.slice(0, 10)}.pptx`;
}

const day = (iso: string | null, empty: string) => (iso === null ? empty : iso.slice(0, 10));

function designRows(design: unknown): string[][] {
  if (typeof design !== "object" || design === null) return [];
  const d = design as Record<string, unknown>;
  const rows: string[][] = [];
  if (num(d.baselineRate)) rows.push(["Baseline conversion rate", formatPercent(d.baselineRate)]);
  if (num(d.minDetectableLift)) rows.push(["Smallest lift worth detecting", formatPoints(d.minDetectableLift)]);
  if (num(d.treatmentShare)) rows.push(["Share sent the treatment", formatPercent(d.treatmentShare, 0)]);
  if (num(d.audienceSize)) rows.push(["Audience size", formatCount(d.audienceSize)]);
  if (num(d.conversionWindowHours)) {
    const days = d.conversionWindowHours / 24;
    rows.push(["Conversion window", Number.isInteger(days) ? `${days} ${days === 1 ? "day" : "days"}` : `${d.conversionWindowHours} hours`]);
  }
  return rows;
}

export function buildDeck(input: { entry: DeckEntry; chain?: ChainStep[]; chainTitle?: string; generatedAt: string }): DeckModel {
  const { entry, generatedAt } = input;
  const result = readResult(entry.result);
  const slides: DeckSlide[] = [];

  slides.push({
    kind: "title",
    title: entry.title,
    lines: [
      "Decision deck",
      entry.synthetic ? "Synthetic demo data. No real customer is in this deck." : "Made from this ledger entry.",
      `Made ${generatedAt.slice(0, 10)}`,
    ],
  });

  const type =
    entry.entryType === "confirmatory"
      ? "Confirmatory. The test was registered before it launched, so the plan was fixed before any result."
      : entry.entryType === "exploratory"
        ? "Exploratory. The test was registered after it launched, so the plan was not fixed ahead of the result."
        : "Not set. The test has not been both registered and launched.";
  slides.push({
    kind: "question",
    title: "The question",
    lines: [
      `Hypothesis: ${entry.hypothesis}`,
      `Type: ${type}`,
      `Registered ${day(entry.registeredAt, "not yet")}, launched ${day(entry.launchedAt, "not yet")}.`,
      ...(entry.frameworkTag ? [`Framework tag: ${entry.frameworkTag}.`] : []),
    ],
  });

  if (input.chain) {
    slides.push({
      kind: "chain",
      title: `Evidence chain: ${input.chainTitle ?? "theme"}`,
      lines: ["Every link before the ledger test is an association, not a cause."],
      table: {
        header: ["Link", "Status", "What it says"],
        rows: input.chain.map((s) => [s.label, s.status === "missing" ? "Missing" : "Present", s.text]),
      },
    });
  }

  const rows = designRows(entry.design);
  slides.push({
    kind: "design",
    title: "How the test was designed",
    ...(rows.length > 0
      ? { table: { header: ["Setting", "Value"], rows } }
      : { lines: ["No design was recorded for this entry."] }),
  });

  if (result) {
    const level = `${Number(((1 - result.alpha) * 100).toFixed(6))} percent`;
    const verdict = describeVerdict({
      significant: result.significant,
      lift: result.lift,
      interval: { low: result.interval_low, high: result.interval_high },
    });
    slides.push({
      kind: "result",
      title: "The result",
      table: {
        header: ["Group", "Conversion rate", "People"],
        rows: [
          ["Treatment", formatPercent(result.treatment_rate), formatCount(result.sample_sizes.treatment)],
          ["Control", formatPercent(result.control_rate), formatCount(result.sample_sizes.control)],
        ],
      },
      chart: {
        title: "Conversion rate, percent",
        labels: ["Treatment", "Control"],
        values: [Number((result.treatment_rate * 100).toFixed(6)), Number((result.control_rate * 100).toFixed(6))],
      },
      lines: [
        `Lift ${formatSignedPoints(result.lift)}, with a ${level} interval from ${formatSignedPoints(result.interval_low)} to ${formatSignedPoints(result.interval_high)}.`,
        `p value ${result.p_value.toFixed(4)}.`,
        `${verdict.label}. ${verdict.text}`,
      ],
    });
  } else {
    slides.push({
      kind: "result",
      title: "The result",
      lines: [`No result has been recorded yet. The entry is ${entry.status}.`],
    });
  }

  const caveats: string[] = [];
  if (entry.synthetic) caveats.push("The data is synthetic. The numbers show how the method works, not how a real audience behaves.");
  caveats.push(correctionLine(entry.correctionMethod, entry.comparisonsCount));
  if (result?.method) caveats.push(`Method: ${result.method}.`);
  if (result?.engine_version) caveats.push(`Statistics engine version ${result.engine_version}.`);
  if (input.chain) {
    caveats.push("The links in the evidence chain before the test are an association, not a cause. Only a test with a holdout supports a causal reading.");
  }
  if (entry.provenance === "imported") caveats.push("This entry was imported from a file, so its times are not verified.");
  slides.push({ kind: "caveats", title: "What to keep in mind", lines: caveats });

  return { fileName: deckFileName(entry.title, generatedAt), slides };
}
