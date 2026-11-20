import { detectNames } from "./names";
import type { Finding, RedactionType } from "./types";

type Span = { start: number; end: number };

function matchAll(re: RegExp, text: string): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(re)) {
    out.push({ start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Email
//
// The scan starts at each at sign and reads outward a bounded number of
// characters, so time grows with the length of the text, not its square.
// A single regular expression that starts at every position took 8.7 seconds
// on one 100,000 character token with no at sign. Letters and digits from any
// script count, so a lookalike letter cannot leave half an address behind, and
// invisible characters inside an address are read as part of it.
// Obfuscated forms such as "jane at example dot com" are not matched.
// ---------------------------------------------------------------------------

const MAX_LOCAL_CHARS = 256;
const MAX_DOMAIN_CHARS = 255;

/** Soft hyphen, zero width space, zero width non joiner, zero width joiner, word joiner, byte order mark. */
const INVISIBLE_CODES = [0x00ad, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff];
const INVISIBLE_RE = new RegExp(`[${INVISIBLE_CODES.map((c) => String.fromCharCode(c)).join("")}]`, "g");
/** An at sign, a percent encoded at sign, or a full width at sign. */
const AT_RE = new RegExp(`%40|[@${String.fromCharCode(0xff20)}]`, "g");

const LETTER_OR_NUMBER = /^[\p{L}\p{N}\p{M}]$/u;
const DOMAIN_RE =
  /^(?:[\p{L}\p{N}\p{M}](?:[\p{L}\p{N}\p{M}-]*[\p{L}\p{N}\p{M}])?\.)+\p{L}[\p{L}\p{N}\p{M}-]*[\p{L}\p{N}\p{M}]$/u;

function isInvisible(code: number): boolean {
  return INVISIBLE_CODES.includes(code);
}

/** ASCII letters, digits and the listed punctuation, or any letter or digit in any script. */
function isNameChar(ch: string, extra: string): boolean {
  if (ch.length === 1) {
    const c = ch.charCodeAt(0);
    if (c < 128) {
      return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || extra.includes(ch);
    }
    if (isInvisible(c)) return true;
  }
  return LETTER_OR_NUMBER.test(ch);
}

function charBefore(text: string, i: number): string {
  const low = text.charCodeAt(i - 1);
  if (low >= 0xdc00 && low <= 0xdfff && i >= 2) {
    const high = text.charCodeAt(i - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(i - 2, i);
  }
  return text.slice(i - 1, i);
}

function charAfter(text: string, i: number): string {
  const high = text.charCodeAt(i);
  if (high >= 0xd800 && high <= 0xdbff && i + 1 < text.length) {
    const low = text.charCodeAt(i + 1);
    if (low >= 0xdc00 && low <= 0xdfff) return text.slice(i, i + 2);
  }
  return text.slice(i, i + 1);
}

export function detectEmails(text: string): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(AT_RE)) {
    const at = m.index!;
    const atEnd = at + m[0].length;

    let start = at;
    for (let n = 0; start > 0 && n < MAX_LOCAL_CHARS; n++) {
      const ch = charBefore(text, start);
      if (!isNameChar(ch, "._%+-")) break;
      start -= ch.length;
    }
    if (start === at) continue;

    let end = atEnd;
    for (let n = 0; end < text.length && n < MAX_DOMAIN_CHARS; n++) {
      const ch = charAfter(text, end);
      if (!isNameChar(ch, ".-")) break;
      end += ch.length;
    }
    // A sentence period or a stray hyphen after the address is not part of it.
    while (end > atEnd && (text[end - 1] === "." || text[end - 1] === "-" || isInvisible(text.charCodeAt(end - 1)))) {
      end--;
    }
    const domain = text.slice(atEnd, end).replace(INVISIBLE_RE, "");
    if (DOMAIN_RE.test(domain)) out.push({ start, end });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Card-like numbers
//
// 13 to 19 digits, grouped by up to two spaces, dots or dashes between digits.
// There is no checksum test: a number a customer mistyped fails the checksum
// and is still a card number. Over-redacting a long digit run, such as a
// 13 digit timestamp, is the safe direction. Runs of 12 or fewer digits and
// of 20 or more digits are not card shaped and are left alone.
// ---------------------------------------------------------------------------

const CARD_RE = /(?<!\d)\d(?:[ .-]{0,2}\d){12,18}(?!\d)/g;

export function detectCards(text: string): Span[] {
  return matchAll(CARD_RE, text);
}

// ---------------------------------------------------------------------------
// US social security numbers, written 123-45-6789 or 123 45 6789. Nine digits
// with no separators are not matched, because they look like an order number.
// ---------------------------------------------------------------------------

const SSN_RE = /(?<![\d-])\d{3}[- ]\d{2}[- ]\d{4}(?![\d-])/g;

export function detectSsns(text: string): Span[] {
  return matchAll(SSN_RE, text);
}

// ---------------------------------------------------------------------------
// IPv4 addresses. Four parts with no part above 255. A fifth part, as in a
// longer version number, is not an address. A software version of exactly
// four parts is redacted, which is the safe direction.
// ---------------------------------------------------------------------------

const IPV4_RE = /(?<!\d)(?<!\d\.)\d{1,3}(?:\.\d{1,3}){3}(?!\d)(?!\.\d)/g;

export function detectIps(text: string): Span[] {
  return matchAll(IPV4_RE, text).filter((s) =>
    text
      .slice(s.start, s.end)
      .split(".")
      .every((part) => Number(part) <= 255),
  );
}

// ---------------------------------------------------------------------------
// Phones and street addresses, unchanged in this version.
// ---------------------------------------------------------------------------

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
  { type: "ssn", detect: detectSsns },
  { type: "ip", detect: detectIps },
  { type: "phone", detect: detectPhones },
  { type: "address", detect: detectAddresses },
  // Last, so a name inside an email address or a street name is redacted as that type.
  { type: "name", detect: detectNames },
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
