/**
 * Matches a question to one of a few known question types. Built as a hybrid after the model alone proved too weak:
 * on tuning questions a similarity cut could not tell a real question from an out of scope one, because traps scored as
 * high as real questions, and it picked the wrong type for about a quarter of the real ones.
 *
 * So the type comes from fixed keyword cues, and the model only checks and breaks ties:
 * 1. Sentences that try to instruct the assistant are dropped, never acted on.
 * 2. Keyword cues propose types. A specific cue beats a generic one, and a sentence with no cue matches no type unless the
 *    model is very sure.
 * 3. A proposed type stands only when the sentence is also close enough to that type's example questions, so a cue word
 *    inside a question about something else does not count.
 *
 * The model turns sentences into vectors and decides nothing alone. Nothing the model produces reaches an answer except a
 * check on the choice of question type. The two cuts are chosen on the tuning questions only.
 */
import { splitSentences, type Embed } from "./coder";

export type IntentId = "count_pain" | "top_pains" | "revenue" | "stop_link" | "carriers" | "redaction" | "consent" | "severe" | "examples";

export const INTENTS: readonly { id: IntentId; needsPain: boolean; examples: readonly string[] }[] = [
  {
    id: "count_pain",
    needsPain: true,
    examples: [
      "How many comments mention this complaint?",
      "How many customers complained about this problem?",
      "How often does this issue come up?",
      "What is the number of comments about this?",
      "How many comments say shipping is too expensive?",
      "How many people complained about the price?",
      "How many reviews mention the delivery being slow?",
      "How many comments are about the website crashing?",
      "How many mention poor customer support?",
      "How many comments say the product page lacks details?",
    ],
  },
  {
    id: "top_pains",
    needsPain: false,
    examples: [
      "What do customers complain about most?",
      "Which complaint is the most common?",
      "What are the biggest problems customers raise?",
      "Rank the complaints from most to least common.",
      "What is the most common problem?",
      "List the top complaints.",
      "Which issues do customers bring up the most?",
    ],
  },
  {
    id: "revenue",
    needsPain: true,
    examples: [
      "How much revenue comes from customers who raised this?",
      "What is the revenue tied to this complaint?",
      "How many dollars are from people who complained about this?",
      "How much money is at stake for this problem?",
      "How much money comes from people who complained about the price?",
      "What revenue goes with the shipping complaint?",
      "What are the sales from customers who reported a site bug?",
    ],
  },
  {
    id: "stop_link",
    needsPain: true,
    examples: [
      "Does this complaint go with customers leaving at the cart?",
      "Do people who stopped raise this more than people who went on?",
      "At which step does this problem go with customers dropping off?",
      "Is this complaint linked to abandoning the purchase?",
      "Do customers who abandoned their order mention shipping more?",
      "Is the price complaint linked to people giving up?",
      "Which step do people leave at when they raise this?",
    ],
  },
  {
    id: "carriers",
    needsPain: true,
    examples: [
      "Which customer groups raise this complaint?",
      "Which segments complain about this the most?",
      "Who raises this problem, new or returning customers?",
      "Which channel do these complaints come from?",
      "Which segment complains about the price?",
      "Which kind of customers mention delivery problems?",
      "Is it new or returning customers who raise this?",
    ],
  },
  {
    id: "redaction",
    needsPain: false,
    examples: [
      "How many names got through redaction?",
      "Did redaction catch the emails and phone numbers?",
      "How well does the redaction work?",
      "Were personal details removed from the comments?",
      "Were names removed from the comments?",
      "How many card numbers or addresses got through?",
      "Is it safe to show these comments?",
    ],
  },
  {
    id: "consent",
    needsPain: false,
    examples: [
      "How many comments were left out?",
      "How many customers did not give consent?",
      "How many comments are kept?",
      "How many comments were withheld?",
      "How many comments were removed because the customer declined?",
      "How many comments are used in the analysis?",
      "How many customers said no to their comment being used?",
    ],
  },
  {
    id: "severe",
    needsPain: true,
    examples: [
      "How many of these comments are rated severe?",
      "How serious are the comments about this?",
      "How many comments about this are high severity?",
      "How bad are these complaints?",
      "How many comments about delivery are severe?",
      "How severe are the site complaints?",
      "How many of the shipping comments are serious?",
    ],
  },
  {
    id: "examples",
    needsPain: true,
    examples: [
      "Show me examples of comments about this.",
      "Give me a quote from a customer about this.",
      "What do customers actually say about this?",
      "Can I read some of these comments?",
      "Show me some quotes about shipping.",
      "Let me read a few comments about the site problems.",
      "What do people write about the price?",
    ],
  },
];

export const MAX_QUESTION_CHARS = 500;

/** Sentences that try to instruct the assistant. Dropped before matching, so they cannot steer anything. */
const INSTRUCTION = [
  /\b(ignore|disregard|forget|override)\b[^.?!]*\b(above|previous|prior|instructions?|rules?|everything|safety)\b/i,
  /\bdeveloper mode\b/i,
  /\bnew rule\b/i,
  /^\s*system\s*:/i,
  /\bpretend (you are|to be)\b/i,
  /\bfrom now on\b/i,
  /\bunrestricted\b/i,
  /\bjailbreak\b/i,
];
export function isInstruction(sentence: string): boolean {
  return INSTRUCTION.some((re) => re.test(sentence));
}

/** Keyword cues per type. Written from general English, not from any test set. */
const CUES: Readonly<Record<IntentId, RegExp>> = {
  consent: /\bconsent\b|\bwithheld\b|\bleft out\b|\bexclude[ds]?\b|\bdeclin\w*|\bsaid no\b|\bheld back\b|\bopt(ed)? out\b|\bkept\b|\bincluded\b|\bused in the analysis\b|\bhow many (comments|people|customers) (are|were) (we )?(actually )?using\b/i,
  redaction: /\bredact\w*|\bscrub\w*|\banonym\w*|\bpersonal (details|information|data)\b|\bpii\b|\bslipped through\b|\bgot through\b|\bstill in the text\b|\btraced? back\b|\bnames\b|\bphone numbers?\b|\bcard numbers?\b|\bemail addresses\b|\bsafe to show\b|\bcleaned\b|\bstripped\b|\bremoval\b/i,
  revenue: /\brevenue\b|\bsales\b|\bdollars?\b|\bmoney\b|\bspen[dt]\b|\bearn\w*|\bbrought in\b|\bworth\b|\bincome\b/i,
  severe: /\bsevere\b|\bseverity\b|\bserious\w*|\bangry\b|\bhow bad\b|\bcritical\b/i,
  examples: /\bexamples?\b|\bquotes?\b|\bread\b|\bshow me\b|\bpull up\b|\bwhat (do|did) (people|customers|they) (write|say|actually)\b|\bgive me (a|an|some)\b|\bcan i see\b|\bverbatim\b/i,
  stop_link: /\babandon\w*|\bgiv(e|en|ing) up\b|\bgave up\b|\bstopp\w*|\bleft\b(?! out)|\bleav(e|es|ing)\b|\bdrop(ped|ping)? off\b|\bchurn\w*|\bgo(es)? with\b|\blinked\b|\btied to\b|\bassociated\b|\bmore likely\b|\bwhich step\b|\bat what step\b|\bwhere do\b/i,
  carriers: /\bsegments?\b|\bchannels?\b|\bgroups?\b|\bwhich (kind|type|sort) of customers?\b|\bnew or returning\b|\bnew customers\b|\breturning customers\b|\b(ad|email|organic) customers\b|\bwho (complains?|raises?|reports?|mentions?|brings?)\b|\bwhich customers\b|\bbehind\b/i,
  top_pains: /\bmost\b|\btop\b|\bbiggest\b|\bmain\b|\bleading\b|\bmajor\b|\brank\w*|\bcommon\b|\bgripes?\b|\bnumber one\b/i,
  count_pain: /\bhow many\b|\bhow often\b|\bnumber of\b|\bcount\b|\btotal\b|\bhow much\b/i,
};
const SPECIFIC: readonly IntentId[] = ["consent", "redaction", "revenue", "severe", "examples", "stop_link", "carriers"];

/** The types a sentence's keywords propose, with the generic ones dropped when a specific one is present. */
export function cuesFor(sentence: string): IntentId[] {
  const hit = (Object.keys(CUES) as IntentId[]).filter((id) => CUES[id].test(sentence));
  const specific = hit.filter((id) => SPECIFIC.includes(id));
  return specific.length > 0 ? specific : hit;
}

export type SentenceAnalysis = { text: string; cues: IntentId[]; scores: Record<IntentId, number> };
export type Analysis = { sentences: SentenceAnalysis[]; dropped: number };
export type Cuts = {
  /** The similarity a cue proposed type needs to stand. */
  guard: number;
  /** The similarity needed when no cue fired, which should be much higher. */
  fallback: number;
};
export type IntentMatch = { intent: IntentId | null; score: number; sentence: string | null };
export type IntentMatcher = {
  /** The model's part, done once per question: nothing in it depends on the cuts. */
  analyse(question: string): Promise<Analysis>;
  match(question: string): Promise<IntentMatch>;
};

const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/** Applies the cuts to an analysis. Pure, so the cuts can be tuned on analyses already made. */
export function decide(analysis: Analysis, cuts: Cuts): IntentMatch {
  let best: IntentMatch = { intent: null, score: -1, sentence: null };
  for (const s of analysis.sentences) {
    let pick: { id: IntentId; score: number } | null = null;
    for (const id of s.cues) if (s.scores[id] >= cuts.guard && (!pick || s.scores[id] > pick.score)) pick = { id, score: s.scores[id] };
    if (!pick && s.cues.length === 0) {
      for (const id of Object.keys(s.scores) as IntentId[]) if (s.scores[id] >= cuts.fallback && (!pick || s.scores[id] > pick.score)) pick = { id, score: s.scores[id] };
    }
    if (pick && pick.score > best.score) best = { intent: pick.id, score: pick.score, sentence: s.text };
  }
  return best;
}

export async function createIntentMatcher(embed: Embed, cuts: Cuts): Promise<IntentMatcher> {
  for (const c of [cuts.guard, cuts.fallback]) if (!(c > -1 && c < 1)) throw new RangeError("A cut must be between -1 and 1.");
  const protos = INTENTS.flatMap((i) => i.examples.map((e) => ({ id: i.id, e })));
  const protoVectors = await embed(protos.map((p) => p.e));
  const analyse = async (question: string): Promise<Analysis> => {
    if (question.length > MAX_QUESTION_CHARS) throw new RangeError(`A question may be at most ${MAX_QUESTION_CHARS} characters.`);
    const all = splitSentences(question);
    const kept = all.filter((s) => !isInstruction(s.text));
    if (kept.length === 0) return { sentences: [], dropped: all.length };
    const vectors = await embed(kept.map((s) => s.text));
    const sentences = kept.map((s, si) => {
      const scores = Object.fromEntries(INTENTS.map((i) => [i.id, -2])) as Record<IntentId, number>;
      protos.forEach((p, pi) => {
        const v = dot(vectors[si], protoVectors[pi]);
        if (v > scores[p.id]) scores[p.id] = v;
      });
      return { text: s.text, cues: cuesFor(s.text), scores };
    });
    return { sentences, dropped: all.length - kept.length };
  };
  return { analyse, match: async (q) => decide(await analyse(q), cuts) };
}
