import { detectAll } from "./detectors";
import type { RedactionCounts, RedactionResult, RedactionType } from "./types";

/**
 * Rule-based redaction. Plain TypeScript, no model, no dependency.
 *
 * Covers four types: email addresses, phone numbers, card-like numbers
 * (Luhn checked) and street address patterns.
 *
 * NOT COVERED: personal names. These rules do not detect or remove names.
 * Text that passes through here can still contain names. Do not treat
 * redacted output as anonymous.
 */

const PLACEHOLDER: Record<RedactionType, string> = {
  email: "[EMAIL]",
  phone: "[PHONE]",
  card: "[CARD]",
  address: "[ADDRESS]",
};

export function redact(input: string): RedactionResult {
  const findings = detectAll(input);
  const counts: RedactionCounts = { email: 0, phone: 0, card: 0, address: 0 };
  let text = "";
  let cursor = 0;
  for (const f of findings) {
    text += input.slice(cursor, f.start) + PLACEHOLDER[f.type];
    cursor = f.end;
    counts[f.type]++;
  }
  text += input.slice(cursor);
  return { text, findings, counts };
}
