/**
 * Turns raw comments into rows that are safe to store and show. Every comment is redacted first, a comment without
 * consent is then withheld, and only the redacted quote is kept. The raw text never leaves this function.
 */
import { redactQuote, type RedactedQuote } from "../redaction/quote";
import type { Pain, SyntheticComment } from "./comments";

export const COMMENT_COLUMN = "comment_text";

export type CommentRow = {
  customer: number;
  segment: SyntheticComment["segment"];
  channel: SyntheticComment["channel"];
  reached: string;
  pain: Pain;
  severity: 1 | 2 | 3;
  quote: RedactedQuote;
};

type Kind = "email" | "phone" | "card" | "address" | "name";
export type ScoreLine = { planted: number; caught: number; missed: number; coveredByRules: boolean };
export type Scorecard = Record<Kind, ScoreLine>;

export type Prepared = { rows: CommentRow[]; withheld: number; scorecard: Scorecard };

const KINDS: readonly Kind[] = ["email", "phone", "card", "address", "name"];
/** The rules cover these. Names are covered only partly: the generator's sign-offs are an easy form, see names.ts. */
const COVERED: Readonly<Record<Kind, boolean>> = { email: true, phone: true, card: true, address: true, name: true };

export function prepareComments(comments: readonly SyntheticComment[]): Prepared {
  const rows: CommentRow[] = [];
  const planted: Record<Kind, number> = { email: 0, phone: 0, card: 0, address: 0, name: 0 };
  const caught: Record<Kind, number> = { email: 0, phone: 0, card: 0, address: 0, name: 0 };
  let withheld = 0;
  for (const c of comments) {
    // Redaction runs on every comment, so the scorecard measures all of them. Only consented ones are kept.
    const quote = redactQuote({ text: c.text, sourceColumn: COMMENT_COLUMN });
    for (const k of KINDS) {
      planted[k] += c.planted[k];
      caught[k] += quote.stamp.counts[k];
    }
    if (!c.consent) {
      withheld += 1;
      continue;
    }
    rows.push({ customer: c.customer, segment: c.segment, channel: c.channel, reached: c.reached, pain: c.pain, severity: c.severity, quote });
  }
  const scorecard = {} as Scorecard;
  for (const k of KINDS) {
    scorecard[k] = { planted: planted[k], caught: caught[k], missed: Math.max(0, planted[k] - caught[k]), coveredByRules: COVERED[k] };
  }
  return { rows, withheld, scorecard };
}

/** Redacts an edited text again and returns a new row. The edit can never put raw details back in. */
export function reRedact(row: CommentRow, editedText: string): CommentRow {
  return { ...row, quote: redactQuote({ text: editedText, sourceColumn: COMMENT_COLUMN }) };
}
