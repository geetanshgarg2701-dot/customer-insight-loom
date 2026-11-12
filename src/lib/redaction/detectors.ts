import { luhnValid } from "./luhn";
import type { Finding, RedactionType } from "./types";

type Span = { start: number; end: number };

function matchAll(re: RegExp, text: string): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(re)) {
    out.push({ start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

/** user@host.tld, ASCII only. Obfuscated forms ("jane at example dot com") are not matched. */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

export function detectEmails(text: string): Span[] {
  return matchAll(EMAIL_RE, text);
}

/**
 * Card-like: 13 to 19 digits, optionally grouped by single spaces or dashes,
 * and the digits must pass the Luhn test.
 */
const CARD_CANDIDATE_RE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;

export function detectCards(text: string): Span[] {
  const out: Span[] = [];
  for (const span of matchAll(CARD_CANDIDATE_RE, text)) {
    const digits = text.slice(span.start, span.end).replace(/[ -]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) out.push(span);
  }
  return out;
}

/** International: a plus, a country code, then 2 to 4 groups of 2 to 4 digits. */
const PHONE_INTL_RE = /\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}(?!\d)/g;

/** North American: optional +1, then 3-3-4 digits with common separators and an optional extension. */
const PHONE_NANP_RE =
  /(?<![\d+])(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-]?)\d{3}[\s.-]?\d{4}(?!\d)(?:\s?(?:ext\.?|x)\s?\d{1,5}(?!\d))?/gi;

export function detectPhones(text: string): Span[] {
  const intl = matchAll(PHONE_INTL_RE, text);
  const nanp = matchAll(PHONE_NANP_RE, text).filter(
    (n) => !intl.some((i) => n.start < i.end && n.end > i.start),
  );
  return [...intl, ...nanp];
}

// Full words keep a following period as sentence punctuation. Only the
// abbreviations may take their own period ("St.", "Ave.").
const SUFFIX =
  "(?:(?:Street|Avenue|Road|Boulevard|Drive|Lane|Court|Way|Place|Terrace|Parkway|Circle|Highway|Square|Trail)\\b|(?:St|Ave|Rd|Blvd|Dr|Ln|Ct|Pl|Ter|Pkwy|Cir|Hwy|Sq|Trl)\\b\\.?)";
// A name word is letters, or an ordinal such as 5th. Plain digits are not
// name words, so the tail of a phone number cannot be read as part of a street.
const NAME_WORD = "(?:\\d+(?:st|nd|rd|th)|[A-Za-z'’-]+)";
const DIRECTION =
  "(?:N|S|E|W|NE|NW|SE|SW|North|South|East|West|Northeast|Northwest|Southeast|Southwest)";
const UNIT = "(?:,?\\s+(?:Apt|Apartment|Suite|Ste|Unit|Floor|Fl|#)\\.?\\s*#?[A-Za-z0-9-]+)?";

/**
 * Street address: house number, optional direction, 1 to 4 name words, a
 * street suffix (Street, Ave, Rd, ...), optional unit. Also PO boxes.
 * Case-insensitive, so it can over-match a phrase such as "2 big dogs on the Drive".
 * Over-redacting is the safe direction here.
 */
const ADDRESS_RE = new RegExp(
  `(?<![\\d.\\-/])\\b\\d{1,6}\\s+(?:${DIRECTION}\\.?\\s+)?(?:${NAME_WORD}\\s+){1,4}?${SUFFIX}${UNIT}`,
  "gi",
);
const PO_BOX_RE = /\b(?:P\.?\s?O\.?|Post\s+Office)\s+Box\s+\d+\b/gi;

export function detectAddresses(text: string): Span[] {
  // PO boxes first: the specific rule must win over the looser street rule.
  return [...matchAll(PO_BOX_RE, text), ...matchAll(ADDRESS_RE, text)];
}

/** Detectors in priority order. An earlier type wins when spans overlap. */
export const DETECTORS: ReadonlyArray<{
  type: RedactionType;
  detect: (text: string) => Span[];
}> = [
  { type: "email", detect: detectEmails },
  { type: "card", detect: detectCards },
  { type: "phone", detect: detectPhones },
  { type: "address", detect: detectAddresses },
];

export function detectAll(text: string): Finding[] {
  const accepted: Finding[] = [];
  for (const { type, detect } of DETECTORS) {
    for (const span of detect(text)) {
      const overlaps = accepted.some((a) => span.start < a.end && span.end > a.start);
      if (!overlaps) accepted.push({ type, ...span });
    }
  }
  return accepted.sort((a, b) => a.start - b.start);
}
