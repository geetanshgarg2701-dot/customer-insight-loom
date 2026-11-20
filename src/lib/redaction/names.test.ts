import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { syntheticJourneys } from "../demo/journeys";
import { syntheticComments } from "../insights/comments";
import { detectNames } from "./names";
import { redactQuote } from "./quote";
import { redact } from "./redact";
import { checkNames } from "./name-check";
import { CLEAN_SENTENCES, PLANTED_NAMES } from "./testdata/planted-names";

describe("detectNames on single cases", () => {
  it("redacts the name after a sign-off, an introduction, a title, a role and a greeting, and keeps the cue", () => {
    expect(redact("Box was wet. Thanks, Alex Rivera.").text).toBe("Box was wet. Thanks, [NAME].");
    expect(redact("My name is Jane Doe and I live nearby.").text).toBe("My name is [NAME] and I live nearby.");
    expect(redact("Dr. Elena Rossi said so.").text).toBe("Dr. [NAME] said so.");
    expect(redact("The agent Marcus hung up.").text).toBe("The agent [NAME] hung up.");
    expect(redact("Hi Sam, it broke.").text).toBe("Hi [NAME], it broke.");
  });

  it("redacts a listed first name anywhere with its surname, and a possessive without its 's", () => {
    expect(redact("Carlos Mendez fixed it.").text).toBe("[NAME] fixed it.");
    expect(redact("Kevin's advice was right.").text).toBe("[NAME]'s advice was right.");
  });

  it("leaves capitalized words that are not names alone", () => {
    for (const s of ["Best Buy had it cheaper.", "Will it ship to Canada?", "We drove to San Diego.", "I'm happy with the Premium plan."]) {
      expect(redact(s).text, s).toBe(s);
    }
  });

  it("does not stretch a name over a weekday or a team that follows it", () => {
    expect(redact("Thanks, Priya Monday.").text).toBe("Thanks, [NAME] Monday.");
    expect(redact("I spoke with Customer Service.").text).toBe("I spoke with Customer Service.");
  });

  it("lets an email address or a street win over a name inside it", () => {
    const r = redact("Write to sarah.jones@example.com or 12 Sarah Street.");
    expect(r.text).toBe("Write to [EMAIL] or [ADDRESS].");
    expect(r.counts.name).toBe(0);
  });

  it("counts names in the redaction counts", () => {
    expect(redact("Thanks, Priya. Ask for Deepak.").counts.name).toBe(2);
  });

  it("issues a stamped quote for every planted and clean sentence, so a second pass finds nothing new", () => {
    for (const s of [...PLANTED_NAMES.map((p) => p.text), ...CLEAN_SENTENCES, "Thanks, Ana Lucia Ortiz Maria."]) {
      expect(() => redactQuote({ text: s, sourceColumn: "comment_text" }), s).not.toThrow();
    }
  });

  it("stays fast on long text", () => {
    const long = "Thanks, Priya Raman. ".repeat(1000) + "x".repeat(10_000);
    const t0 = performance.now();
    detectNames(long);
    expect(performance.now() - t0).toBeLessThan(2_000);
  });
});

describe("the planted name set, written before the rules", () => {
  it("reports what the rules catch and miss, by form, and every false alarm", () => {
    const check = checkNames();
    const { rows, caught } = check;
    const falseAlarms = check.falseAlarmSentences.map((s) => ({ s }));
    const variants = [...new Set(rows.map((r) => r.variant))];
    const lines = [
      `Planted names: ${caught} of ${rows.length} caught. False alarms: ${falseAlarms.length} of ${CLEAN_SENTENCES.length} clean sentences.`,
      ...variants.map((v) => {
        const of = rows.filter((r) => r.variant === v);
        return `  ${v}: ${of.filter((r) => r.caught).length} of ${of.length}`;
      }),
      "Missed:",
      ...rows.filter((r) => !r.caught).map((r) => `  ${r.id} [${r.variant}] ${JSON.stringify(r.value)}`),
      "False alarms:",
      ...falseAlarms.map((x) => `  ${JSON.stringify(x.s)} -> ${JSON.stringify(redact(x.s).text)}`),
    ];
    if (process.env.NAMES_REPORT) writeFileSync(process.env.NAMES_REPORT, lines.join("\n"));
    // Measured on 2026-11-19: 49 of 60 caught, no false alarms. A change in the rules that loses a name or adds a false
    // alarm fails here. The set and the rules were written in the same session, so this is likely better than real text.
    expect(caught).toBeGreaterThanOrEqual(49);
    expect(falseAlarms).toEqual([]);
  });
});

describe("the comment generator's names", () => {
  it("are all caught, which is the easy sign-off form only, so the screen must also show the planted set result", () => {
    const comments = syntheticComments(syntheticJourneys(5_000, 11), 1_000, 17);
    for (const c of comments) {
      expect(redact(c.text).counts.name, c.text).toBe(c.planted.name);
    }
  });
});
