/**
 * The behavioral hypothesis library, plan feature E: ideas about why a customer might act, each written as a hypothesis a
 * holdout test can answer. Picking one starts a ledger draft, so the bet is written down as a prediction that can turn
 * out wrong, which is what the ledger is for.
 *
 * What this is not: evidence. No idea here says it works, how well, or for whom. A number in a template would read as an
 * expected effect, so a test refuses any digit. Each idea carries a note on how to use it honestly, because several of
 * these levers become deceptive when the claim behind them is not true.
 */

export type BehavioralHypothesis = {
  id: string;
  name: string;
  /** The idea in a sentence, in plain words. */
  idea: string;
  /** A ledger title with [placeholders]. */
  titleTemplate: string;
  /** The hypothesis with [placeholders]: a prediction against a holdout, with the reason. */
  hypothesisTemplate: string;
  /** What the test should measure first. */
  primaryMetric: string;
  /** How to use the idea honestly. */
  watchOut: string;
};

export const HYPOTHESES: readonly BehavioralHypothesis[] = [
  {
    id: "scarcity",
    name: "Scarcity",
    idea: "People value something more when it is genuinely hard to get, such as limited stock or a real deadline.",
    titleTemplate: "Low stock notice for [segment]",
    hypothesisTemplate:
      "If we tell [segment] that [item] is low in stock, then more of them will buy it within the conversion window than the holdout, because a real limit makes waiting cost something.",
    primaryMetric: "Purchases of the item within the conversion window.",
    watchOut:
      "Say low stock or a deadline only when it is true. A countdown that resets, or a stock level that is made up, is a deceptive practice.",
  },
  {
    id: "social-proof",
    name: "Social proof",
    idea: "When people are unsure, they look at what others like them have done.",
    titleTemplate: "Customer count in the email to [segment]",
    hypothesisTemplate:
      "If we show [segment] how many customers chose [item], then more of them will buy it than the holdout, because the choices of others reduce doubt.",
    primaryMetric: "Purchases of the item within the conversion window, with clicks as a second check.",
    watchOut:
      "Use only counts and reviews that are real and current. Never invent a figure, and never quote a customer without their consent.",
  },
  {
    id: "loss-aversion",
    name: "Loss aversion",
    idea: "A loss weighs more than an equal gain, so naming what a person would miss can move them.",
    titleTemplate: "Name the missed benefit for [segment]",
    hypothesisTemplate:
      "If we tell [segment] what they stop getting when [benefit] ends, then more of them will act than the holdout, because losing something weighs more than gaining the same thing.",
    primaryMetric: "The action the email asks for, within the conversion window.",
    watchOut: "The end of the benefit must be real. Do not use fear or shame, and avoid wording that hides what it costs.",
  },
  {
    id: "reciprocity",
    name: "Reciprocity",
    idea: "People tend to return a favour, so a small gift first can make a later ask easier.",
    titleTemplate: "Free [gift] before the ask to [segment]",
    hypothesisTemplate:
      "If we give [segment] a free [gift] before we ask them to buy, then more of them will buy within the conversion window than the holdout, because they feel they owe something back.",
    primaryMetric: "Purchases within the conversion window, counted against the cost of the gift.",
    watchOut: "The gift must really be free, with no catch. Do not word it as a favour that has to be repaid.",
  },
  {
    id: "small-first-step",
    name: "Small first step",
    idea: "A person who has taken a small step is more likely to take the next one.",
    titleTemplate: "Small first step for [segment]",
    hypothesisTemplate:
      "If we ask [segment] to take [small step] before the full offer, then more of them will complete the purchase than the holdout, because they act in line with what they already did.",
    primaryMetric: "Completed purchases within the conversion window.",
    watchOut:
      "The first step must be useful on its own and optional. Never trick someone into a commitment, and make the next step easy to decline.",
  },
  {
    id: "easier-path",
    name: "Easier path",
    idea: "People take the route that needs the least effort, so removing a step can move them.",
    titleTemplate: "Remove a step for [segment]",
    hypothesisTemplate:
      "If we remove [step] from the path for [segment], then more of them will finish than the holdout, because fewer steps leave fewer chances to give up.",
    primaryMetric: "Completion of the path, within the conversion window.",
    watchOut:
      "Do not pre-tick a purchase or a subscription the person did not ask for. A default must serve the customer's own choice, not only yours.",
  },
  {
    id: "price-anchor",
    name: "Price anchor",
    idea: "A person judges a price against the first price they see, so showing the usual price beside the offer changes how the offer feels.",
    titleTemplate: "Show the usual price to [segment]",
    hypothesisTemplate:
      "If we show [segment] the usual price of [item] next to the offer, then more of them will buy than the holdout, because the usual price gives them something to compare against.",
    primaryMetric: "Purchases of the item within the conversion window, with revenue per customer as a second check.",
    watchOut: "The usual price must be a price the item really sold at. Never show a crossed out price that was never charged.",
  },
  {
    id: "personal-relevance",
    name: "Personal relevance",
    idea: "A message about something the person already looked at feels more useful than a general one.",
    titleTemplate: "Mention what [segment] viewed",
    hypothesisTemplate:
      "If we mention [item] that [segment] viewed, then more of them will click and buy than the holdout, because the message is about something they already care about.",
    primaryMetric: "Clicks, then purchases of the item within the conversion window.",
    watchOut:
      "Only use what the person did on your own site or app, and only where their consent covers it. Avoid showing anything that could embarrass them.",
  },
  {
    id: "clear-next-step",
    name: "Clear next step",
    idea: "A message that asks for one specific action is easier to act on than one that asks for several.",
    titleTemplate: "One clear action for [segment]",
    hypothesisTemplate:
      "If we ask [segment] to [action] and nothing else, then more of them will do it than the holdout, because one clear step takes less thought than several.",
    primaryMetric: "The action itself, within the conversion window.",
    watchOut: "Say honestly what the step does. Do not promise something the next page does not deliver.",
  },
];

export function hypothesisById(id: string): BehavioralHypothesis | undefined {
  return HYPOTHESES.find((h) => h.id === id);
}

/** The placeholders in a text, without their square brackets, each once, in the order they first appear. */
export function findBrackets(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/\[([^[\]]+)\]/g)) {
    const name = m[1].trim();
    if (name !== "" && !found.includes(name)) found.push(name);
  }
  return found;
}

export const MAX_FILL = 80;

/**
 * Replaces each [placeholder] with the value given for it. A blank value leaves the placeholder where it is and lists it
 * as missing. A value is trimmed, cut to 80 characters, and loses any square bracket, so a fill can never add a new
 * placeholder.
 */
export function fillHypothesis(template: string, values: Readonly<Record<string, string>>): { text: string; missing: string[] } {
  const clean = (v: string | undefined) => (v ?? "").replace(/[[\]]/g, "").trim().slice(0, MAX_FILL).trim();
  const missing: string[] = [];
  const text = template.replace(/\[([^[\]]+)\]/g, (whole, raw: string) => {
    const name = raw.trim();
    const value = clean(values[name]);
    if (value === "") {
      if (name !== "" && !missing.includes(name)) missing.push(name);
      return whole;
    }
    return value;
  });
  return { text, missing };
}

/** What a new ledger draft starts with: the idea's title and hypothesis, brackets in place for the person to fill. */
export function startFrom(h: BehavioralHypothesis): { title: string; hypothesis: string; brackets: string[] } {
  return { title: h.titleTemplate, hypothesis: h.hypothesisTemplate, brackets: findBrackets(h.hypothesisTemplate) };
}
