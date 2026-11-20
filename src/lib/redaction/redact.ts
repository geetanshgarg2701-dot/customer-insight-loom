import { detectAll } from "./detectors";
import type { RedactionCounts, RedactionResult, RedactionType } from "./types";

/**
 * Rule-based redaction. Plain TypeScript, no model, no dependency.
 *
 * Covers seven types: email addresses, phone numbers, card-like numbers,
 * US social security numbers, IPv4 addresses, street address patterns and
 * personal names.
 *
 * NAMES ARE ONLY PARTLY COVERED. Names are found after cues such as a sign-off
 * or "my name is", and when a common first name appears. Lowercase names, a
 * surname alone, and names that are not in the list and have no cue get
 * through. Do not treat redacted output as anonymous. See names.ts and
 * docs/2026-11-12-redaction-known-limits.md.
 */

const PLACEHOLDER: Record<RedactionType, string> = {
  email: "[EMAIL]",
  phone: "[PHONE]",
  card: "[CARD]",
  address: "[ADDRESS]",
  ssn: "[SSN]",
  ip: "[IP]",
  name: "[NAME]",
};

export function redact(input: string): RedactionResult {
  const findings = detectAll(input);
  const counts: RedactionCounts = { email: 0, phone: 0, card: 0, address: 0, ssn: 0, ip: 0, name: 0 };
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
