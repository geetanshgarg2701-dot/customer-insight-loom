export type RedactionType = "email" | "phone" | "card" | "address" | "ssn" | "ip";

/** A span in the ORIGINAL text. The matched value is never stored. */
export type Finding = { type: RedactionType; start: number; end: number };

export type RedactionCounts = Record<RedactionType, number>;

export type RedactionResult = {
  /** Text with every finding replaced by a placeholder such as [EMAIL]. */
  text: string;
  findings: Finding[];
  counts: RedactionCounts;
};

/**
 * Bump when the rules change, so stamps on stored quotes can be traced.
 * Version 2: unicode aware emails in linear time, card runs without a checksum
 * test, social security numbers, IPv4 addresses, and a source column check.
 */
export const RULE_VERSION = "2";
