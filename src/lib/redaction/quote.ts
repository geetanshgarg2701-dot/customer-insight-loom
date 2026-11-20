import { assertColumnAllowed } from "./columns";
import { detectAll } from "./detectors";
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
 * Redaction here only partly covers personal names. See redact.ts and names.ts.
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

/** Longest text accepted. Longer text is refused, never cut. */
export const MAX_QUOTE_CHARS = 20000;
const MAX_SOURCE_COLUMN_CHARS = 200;

export class QuoteTooLongError extends Error {
  constructor() {
    super(`Quote text is longer than ${MAX_QUOTE_CHARS} characters and was refused, not cut.`);
    this.name = "QuoteTooLongError";
  }
}

/** Never repeats the column text, which may itself be personal data. */
export class SourceColumnError extends Error {
  constructor() {
    super("The source column name was refused because it is too long or looks like personal data.");
    this.name = "SourceColumnError";
  }
}

const issued = new WeakSet<object>();

/** The only way to make a RedactedQuote. */
export function redactQuote(input: UnredactedQuote): RedactedQuote {
  if (input.sourceColumn.length > MAX_SOURCE_COLUMN_CHARS || detectAll(input.sourceColumn).length > 0) {
    throw new SourceColumnError();
  }
  assertColumnAllowed(input.sourceColumn);
  if (input.text.length > MAX_QUOTE_CHARS) throw new QuoteTooLongError();
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
      records.push(
        Object.freeze({
          text: quote.text,
          sourceColumn: quote.sourceColumn,
          ruleVersion: quote.stamp.ruleVersion,
        }),
      );
    },
    list(): readonly StoredQuote[] {
      return Object.freeze([...records]);
    },
  };
}
