import { assertColumnAllowed } from "./columns";
import { redact } from "./redact";
import { RULE_VERSION, type RedactionCounts } from "./types";

/**
 * A quote cannot be saved unless it passed redaction.
 *
 * Compile time: saveQuote only accepts RedactedQuote, a branded type that a
 * plain object does not satisfy.
 * Run time: a TypeScript brand can be forged with a cast, so saveQuote also
 * checks a private registry of objects that redactQuote created. A forged
 * cast, a spread copy or a JSON round trip is not in the registry and is
 * rejected.
 *
 * Redaction here does not cover personal names. See redact.ts.
 */

export type UnredactedQuote = { text: string; sourceColumn: string };

export type RedactionStamp = {
  readonly passed: true;
  readonly ruleVersion: string;
  readonly counts: Readonly<RedactionCounts>;
};

declare const redactedBrand: unique symbol;

export type RedactedQuote = Readonly<{
  text: string;
  sourceColumn: string;
  stamp: RedactionStamp;
}> & { readonly [redactedBrand]: "RedactedQuote" };

export class UnredactedQuoteError extends Error {
  constructor() {
    super("Quote was not issued by redactQuote and cannot be saved.");
    this.name = "UnredactedQuoteError";
  }
}

const issued = new WeakSet<object>();

/** The only way to make a RedactedQuote. */
export function redactQuote(input: UnredactedQuote): RedactedQuote {
  assertColumnAllowed(input.sourceColumn);
  const result = redact(input.text);
  // Verify: redacted text must itself be clean, or the pass is refused.
  if (redact(result.text).findings.length > 0) {
    throw new Error("Redaction did not produce clean text; quote refused.");
  }
  const quote = Object.freeze({
    text: result.text,
    sourceColumn: input.sourceColumn,
    stamp: Object.freeze({
      passed: true as const,
      ruleVersion: RULE_VERSION,
      counts: Object.freeze({ ...result.counts }),
    }),
  }) as unknown as RedactedQuote;
  issued.add(quote);
  return quote;
}

export function isRedactedQuote(value: unknown): value is RedactedQuote {
  return typeof value === "object" && value !== null && issued.has(value);
}

export type StoredQuote = {
  readonly text: string;
  readonly sourceColumn: string;
  readonly ruleVersion: string;
};

/** In-memory store, browser only. Nothing here leaves the page. */
export function createQuoteStore() {
  const records: StoredQuote[] = [];
  return {
    saveQuote(quote: RedactedQuote): void {
      if (!isRedactedQuote(quote)) throw new UnredactedQuoteError();
      records.push({
        text: quote.text,
        sourceColumn: quote.sourceColumn,
        ruleVersion: quote.stamp.ruleVersion,
      });
    },
    list(): readonly StoredQuote[] {
      return records;
    },
  };
}
