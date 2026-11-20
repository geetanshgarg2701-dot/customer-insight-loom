import { describe, expect, it } from "vitest";
import { SYNTHETIC_EMAIL } from "../compliance/example";
import { checkEmail } from "../compliance/rules";
import { FRAMEWORK_TAGS } from "../ledger/ledger";
import { PAIN_LABELS, type Pain } from "../insights/comments";
import { DRAFT_LABEL, ADDRESS_PLACEHOLDER, buildDraft, draftHypothesis, type DraftInput } from "./draft";

const INPUT: DraftInput = {
  framework: "PAS",
  pain: "shipping_cost",
  segment: "new",
  brand: "Shop Example",
  offer: "free shipping on orders over 50 dollars",
  callToAction: "Shop the offer",
};
const THEMES = Object.keys(PAIN_LABELS).filter((p) => p !== "no_issue") as Exclude<Pain, "no_issue">[];

describe("buildDraft", () => {
  it("makes a draft for every framework, theme and segment, each with a subject and a body", () => {
    for (const framework of FRAMEWORK_TAGS) {
      for (const pain of THEMES) {
        for (const segment of ["new", "returning", "vip", null] as const) {
          const d = buildDraft({ ...INPUT, framework, pain, segment });
          expect(d.subject.length, `${framework} ${pain} ${segment}`).toBeGreaterThan(5);
          expect(d.body.length).toBeGreaterThan(80);
          expect(d.framework).toBe(framework);
        }
      }
    }
  });

  it("follows the named framework's order, labeling each part", () => {
    const parts = (f: DraftInput["framework"]) => buildDraft({ ...INPUT, framework: f }).parts.map((p) => p.label);
    expect(parts("PAS")).toEqual(["Problem", "Agitate", "Solution", "Action"]);
    expect(parts("FAB")).toEqual(["Feature", "Advantage", "Benefit", "Action"]);
    expect(parts("AIDA")).toEqual(["Attention", "Interest", "Desire", "Action"]);
  });

  it("puts the brand, the offer and the call to action in the body, and speaks to the theme", () => {
    const d = buildDraft(INPUT);
    expect(d.body).toContain("free shipping on orders over 50 dollars");
    expect(d.body).toContain("Shop the offer");
    expect(d.body).toContain("Shop Example");
    expect(d.body.toLowerCase()).toContain("shipping");
    expect(buildDraft({ ...INPUT, pain: "site_bugs", offer: "a faster checkout" }).body.toLowerCase()).toMatch(/site|checkout|app/);
  });

  it("invents no number: every digit in a draft comes from what the person typed", () => {
    for (const framework of FRAMEWORK_TAGS) {
      for (const pain of THEMES) {
        const d = buildDraft({ ...INPUT, framework, pain });
        const typed = INPUT.offer + INPUT.brand + INPUT.callToAction;
        expect(d.subject + d.body, `${framework} ${pain}`).toBeDefined();
        for (const n of (d.subject + "\n" + d.body.replace(ADDRESS_PLACEHOLDER, "")).match(/\d+/g) ?? []) expect(typed, `${framework} ${pain}: ${n}`).toContain(n);
      }
    }
  });

  it("makes no claim about other customers or results, which the app cannot know", () => {
    for (const framework of FRAMEWORK_TAGS) {
      const text = (d: ReturnType<typeof buildDraft>) => `${d.subject} ${d.body}`;
      for (const pain of THEMES) expect(text(buildDraft({ ...INPUT, framework, pain })), `${framework} ${pain}`).not.toMatch(/percent|%|most customers|thousands|everyone|guarantee|best|number one|proven|studies/i);
    }
  });

  it("carries the legal basics: an advertisement label, an opt out line and an address placeholder", () => {
    const d = buildDraft(INPUT);
    expect(d.body).toMatch(/^Advertisement/m);
    expect(d.body).toMatch(/unsubscribe/i);
    expect(d.body).toContain(ADDRESS_PLACEHOLDER);
  });

  it("does not pass the email check while the address placeholder is still there, and does once a real address replaces it", () => {
    const d = buildDraft(INPUT);
    const base = { ...SYNTHETIC_EMAIL, subject: d.subject, body: d.body };
    const blocked = checkEmail(base);
    expect(blocked.approved).toBe(false);
    expect(blocked.blocking).toEqual(["postal-address"]);
    const fixed = checkEmail({ ...base, body: d.body.replace(ADDRESS_PLACEHOLDER, "Shop Example, 100 Harbor Street, Springfield") });
    expect(fixed.approved).toBe(true);
  });

  it("does not open like a reply or a forward, which the email check treats as a misleading subject", () => {
    for (const framework of FRAMEWORK_TAGS) for (const pain of THEMES) expect(buildDraft({ ...INPUT, framework, pain }).subject).not.toMatch(/^\s*(re|fw|fwd)\s*:/i);
  });

  it("is labeled as built from a template, not written by a language model, and needing a person's approval", () => {
    expect(DRAFT_LABEL).toBe("Built by the app from a template and your inputs. No language model wrote it. A person must approve it.");
    expect(buildDraft(INPUT).label).toBe(DRAFT_LABEL);
  });

  it("uses no em dash and no parentheses, and refuses empty inputs and ones too long", () => {
    for (const framework of FRAMEWORK_TAGS) for (const pain of THEMES) expect(buildDraft({ ...INPUT, framework, pain }).body).not.toMatch(/[—()]/);
    for (const bad of [{ brand: " " }, { offer: "" }, { callToAction: "  " }]) expect(() => buildDraft({ ...INPUT, ...bad })).toThrow(RangeError);
    expect(() => buildDraft({ ...INPUT, offer: "x".repeat(201) })).toThrow(RangeError);
    expect(() => buildDraft({ ...INPUT, pain: "no_issue" as never })).toThrow(RangeError);
  });

  it("keeps markup out of the text, since an offer typed with angle brackets is only text", () => {
    const d = buildDraft({ ...INPUT, offer: "a <b>big</b> sale" });
    expect(d.body).toContain("a <b>big</b> sale");
    expect(d.parts.every((p) => typeof p.text === "string")).toBe(true);
  });
});

describe("draftHypothesis", () => {
  it("states the test in one sentence that names the framework, segment and complaint, with no promise of a result", () => {
    const h = draftHypothesis(INPUT);
    expect(h).toBe(
      "A PAS email about free shipping on orders over 50 dollars, sent to new customers who raised Shipping costs too much, changes conversion against a holdout.",
    );
    expect(draftHypothesis({ ...INPUT, segment: null })).toContain("sent to customers who raised");
  });
});
