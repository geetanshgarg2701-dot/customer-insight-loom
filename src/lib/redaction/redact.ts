import { detectAll } from "./detectors";
import type { RedactionCounts, RedactionResult, RedactionType } from "./types";

/**
 * Rule-based redaction. Plain TypeScript, no model, no dependency.
 *
 * Covers six types: email addresses, phone numbers, card-like numbers,
 * US social security numbers, IPv4 addresses and street address patterns.
 *
 * NOT COVERED: personal names. These rules do not detect or remove names.
 * Text that passes through here can still contain names. Do not treat
 * redacted output as anonymous. See docs/2026-11-12-redaction-known-limits.md
 * for the full list of what is not covered.
 */

const PLACEHOLDER: Record<RedactionType, string> = {
  email: "[EMAIL]",
  phone: "[PHONE]",
  card: "[CARD]",
  address: "[ADDRESS]",
  ssn: "[SSN]",
  ip: "[IP]",
};

export function redact(input: string): RedactionResult {
  const findings = detectAll(input);
  const counts: RedactionCounts = { email: 0, phone: 0, card: 0, address: 0, ssn: 0, ip: 0 };
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
