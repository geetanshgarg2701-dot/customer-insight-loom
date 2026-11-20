/**
 * Personal names, found by rules. No model and no dependency.
 *
 * A name is caught in two ways:
 * 1. After a cue that says a name follows: a sign-off ("Thanks, Priya Raman"), an introduction ("my name is"), a title
 *    ("Dr. Rossi"), a role ("the agent Marcus", "named Luis", "spoke with Jennifer"), or a greeting ("Hi Sam,").
 * 2. A common first name from the list below, anywhere, with any capitalized surname that follows it.
 *
 * What it misses, by design and measured by the planted name set: names typed in lowercase, a surname alone, a name
 * that is not in the list and has no cue, and first names that are also ordinary words (Will, Grace, Rose, May), which
 * are left out of the list because catching them would redact ordinary sentences. Redacted text is not anonymous.
 */

type Span = { start: number; end: number };

/** One capitalized name word: Priya, O'Neill, Al-Sayed, McDonald, García. */
const WORD = String.raw`\p{Lu}(?:[\p{Ll}\p{M}]+|(?=['’]))(?:\p{Lu}[\p{Ll}\p{M}]+)?(?:['’-]\p{Lu}?[\p{Ll}\p{M}]+)*`;
/** One to three name words separated by single spaces. */
const NAME = String.raw`${WORD}(?: ${WORD}){0,2}`;

/** Capitalized words that end a name run rather than extend it. */
const NOT_NAME = new Set([
  "I", "The", "A", "An", "And", "But", "Or", "At", "In", "On", "From", "For", "To", "Of", "With", "By", "It", "This",
  "That", "My", "We", "He", "She", "They", "You", "Your", "Our", "Thanks", "Thank", "Please", "Hi", "Hello", "Dear",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "January", "February", "March", "April", "June", "July", "August", "September", "October", "November", "December",
  "Customer", "Service", "Support", "Team", "Store", "Shop", "Refund", "Order", "Help", "Desk", "Sale", "Free",
  "Shipping", "Premium", "Pro", "Max", "Gift", "Guide", "Packing", "Spring", "Christmas",
]);

/**
 * Common given names across many origins, written from general knowledge, not from a dataset. Names that are also
 * common English words are left out on purpose: Will, Grace, Rose, May, June, Hope, Faith, Joy, Mark, Bill, Pat, Sue,
 * Jesus, Art, Chase, Hunter, Summer, Autumn, Dawn, Ray, Rich, Bob, Jack, Frank, Herb, Sunny, Ivy, Lily, Daisy, Amber, Ruby,
 * Pearl, Crystal, Jade, Angel, Major, King, Prince, Sky, Brook, Wade, Glen, Dale, Max, Guy, Gene, Lane, Drew, Pierce.
 */
const FIRST_NAMES = new Set(
  `Aaron Abdul Abigail Adam Adrian Ahmed Aisha Alan Albert Alejandro Alex Alexander Alexandra Ali Alice Alicia Alison
  Amanda Amelia Amir Amit Amy Ana Andre Andrea Andrew Angela Anil Anita Anna Anne Anthony Antonio Arjun Ashley Avery
  Barbara Benjamin Beth Brandon Brian Bruno Caleb Cameron Camila Carlos Carmen Caroline Casey Catherine Charles
  Charlotte Chen Chloe Chris Christina Christine Christopher Claire Colleen Connor Craig Cynthia Daniel Daniela Darius
  David Deborah Deepak Denise Diana Diego Dmitri Dylan Edward Elena Elijah Elizabeth Ella Emily Emma Eric Erica Ethan
  Eva Fatima Felipe Fernando Fiona Francesca Gabriel Gabriela George Gloria Hannah Harold Harry Hassan Heather Helen
  Henry Hiroshi Hussein Ian Ibrahim Igor Ingrid Isaac Isabella Ivan Jacob James Jamie Jane Janet Jasmine Jason Javier
  Jennifer Jeremy Jessica Joanna Joe John Jonathan Jordan Jorge Jose José Joseph Joshua Juan Julia Julian Juliet
  Justin Kaitlyn Karen Karim Katherine Kathleen Keith Kenji Kevin Khalid Kim Kumar Kwame Laura Lauren Layla Leah Leo
  Leon Liam Linda Lisa Logan Lucas Lucia Luis Luke Madison Mahmoud Manuel Marco Marcus Margaret Maria Mariam Marisol
  Martin Mary Matthew Megan Mei Melissa Mia Michael Michelle Miguel Mohamed Mohammed Morgan Muhammad Nadia Natalia
  Natalie Nathan Nicholas Nicole Nikhil Nina Noah Nora Olga Olivia Omar Oscar Pablo Patricia Patrick Paul Paula Pedro
  Peter Philip Priya Quinn Rachel Rafael Rahul Raj Rajesh Rebecca Ricardo Riley Robert Roberto Robin Ryan Samantha
  Samuel Sandra Sara Sarah Scott Sean Sebastian Sergei Shannon Sharon Simon Sofia Sophia Sophie Stephanie Steven Sunil
  Susan Tamara Taylor Teresa Thomas Timothy Tom Tyler Valentina Vanessa Victor Victoria Vikram Vincent Wei William
  Xavier Yasmin Yusuf Zachary Zainab Zoe Sam`.split(/\s+/),
);

const SIGN_OFF = String.raw`(?:Thanks|Thank you|Thx|Many thanks|Cheers|Regards|Best regards|Kind regards|Warm regards|Best wishes|Best|Sincerely|Yours|Love)`;
const TITLE = String.raw`(?:Mr|Mrs|Ms|Mx|Miss|Dr|Prof)\.?`;
const ROLE = String.raw`(?:agent|rep|representative|driver|courier|cashier|manager|associate|technician|employee|neighbor|neighbour|sister|brother|friend|wife|husband|son|daughter|mother|father|mom|dad)`;

/** Each cue, with the name it introduces in group "n". */
const CUES: readonly RegExp[] = [
  // Sign-off with a comma, a dash or a line break before the name: "Thanks, Priya Raman", "Regards\nTom".
  new RegExp(String.raw`(?:^|[.!?]\s+|\n\s*)${SIGN_OFF}\s*(?:,|-|\n)\s*(?<n>${NAME})`, "gu"),
  // "Thanks Marisol" with no comma, when the name ends the sentence or is followed by "for".
  new RegExp(String.raw`\b(?:Thanks|Thank you)\s+(?<n>${NAME})(?=\s*(?:[.!,]|$|\s+for\b))`, "gu"),
  // Introductions. "I'm" and "I am" need a first and a last name, so "I'm Canadian" is left alone.
  new RegExp(String.raw`\b(?:[Mm]y name is|[Mm]y name's|[Cc]all me)\s+(?<n>${NAME})`, "gu"),
  new RegExp(String.raw`\b(?:I'm|I’m|I am|[Tt]his is)\s+(?<n>${WORD} ${WORD}(?: ${WORD})?)`, "gu"),
  // Titles: the title stays and the name goes.
  new RegExp(String.raw`\b${TITLE}\s+(?<n>${NAME})`, "gu"),
  // Roles and verbs that point at a person: "the agent Marcus", "named Luis", "spoke with Jennifer", "ask for Deepak".
  new RegExp(String.raw`\b${ROLE},?\s+(?<n>${NAME})`, "gu"),
  new RegExp(String.raw`\b(?:named|called)\s+(?<n>${NAME})`, "gu"),
  new RegExp(String.raw`\b(?:spoke|talked|spoken|talking|speaking)\s+(?:with|to)\s+(?<n>${NAME})`, "gu"),
  new RegExp(String.raw`\b[Aa]sk(?:ed)?\s+for\s+(?<n>${NAME})`, "gu"),
  // Greetings at the start of the text or a line, followed by a comma or an exclamation mark.
  new RegExp(String.raw`(?:^|\n)\s*(?:Hi|Hello|Hey|Dear)\s+(?<n>${NAME})(?=\s*[,!])`, "gu"),
];

const WORD_RE = new RegExp(WORD, "gu");
const NEXT_WORD_RE = new RegExp(String.raw` (${WORD})`, "uy");
const POSSESSIVE = /['’]s$/u;

/** Drops trailing words that end a run rather than extend it, such as a weekday or "Customer". */
function trim(text: string, start: number, end: number): Span | null {
  const words = [...text.slice(start, end).matchAll(WORD_RE)];
  let keep = words.length;
  while (keep > 0 && NOT_NAME.has(words[keep - 1][0])) keep--;
  if (keep === 0 || NOT_NAME.has(words[0][0])) return null;
  const last = words[keep - 1];
  return { start, end: start + last.index! + last[0].length };
}

function merge(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Span[] = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  return merged;
}

export function detectNames(text: string): Span[] {
  const spans: Span[] = [];
  for (const re of CUES) {
    for (const m of text.matchAll(re)) {
      const n = m.groups!.n;
      const start = m.index! + m[0].lastIndexOf(n);
      const span = trim(text, start, start + n.length);
      if (span) spans.push(span);
    }
  }
  // A listed first name anywhere, with up to two capitalized words after it that are not on the stop list. A possessive
  // such as "Kevin's" is looked up without its "'s". A listed name right after another capitalized word, as in
  // "San Diego", is kept only when that word is itself part of a name found here.
  const afterCapital: { span: Span; before: number }[] = [];
  const words = [...text.matchAll(WORD_RE)];
  for (const [i, m] of words.entries()) {
    const base = m[0].replace(POSSESSIVE, "");
    if (!FIRST_NAMES.has(base)) continue;
    let end = m.index! + base.length;
    if (base === m[0]) {
      for (let extra = 0; extra < 2; extra++) {
        NEXT_WORD_RE.lastIndex = end;
        const next = NEXT_WORD_RE.exec(text);
        if (!next || NOT_NAME.has(next[1])) break;
        end += next[0].length;
      }
    }
    const span = { start: m.index!, end };
    const prev = words[i - 1];
    const joined = prev && prev.index! + prev[0].length + 1 === m.index! && text[m.index! - 1] === " ";
    if (joined && !NOT_NAME.has(prev[0])) afterCapital.push({ span, before: prev.index! });
    else spans.push(span);
  }
  let merged = merge(spans);
  // Add the held back names whose word before them is inside a found name, until nothing more joins.
  for (let changed = true; changed; ) {
    changed = false;
    for (let k = afterCapital.length - 1; k >= 0; k--) {
      const { span, before } = afterCapital[k];
      if (merged.some((s) => s.start <= before && before < s.end)) {
        merged = merge([...merged, span]);
        afterCapital.splice(k, 1);
        changed = true;
      }
    }
  }
  return merged;
}
