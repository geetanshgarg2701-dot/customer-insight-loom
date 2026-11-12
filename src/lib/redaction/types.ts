export type RedactionType = "email" | "phone" | "card" | "address";

/** A span in the ORIGINAL text. The matched value is never stored. */
export type Finding = { type: RedactionType; start: number; end: number };

export type RedactionCounts = Record<RedactionType, number>;

export type RedactionResult = {
  /** Text with every finding replaced by a placeholder such as [EMAIL]. */
  text: string;
  findings: Finding[];
  counts: RedactionCounts;
};

/** Bump when the rules change, so stamps on stored quotes can be traced. */
export const RULE_VERSION = "1";
