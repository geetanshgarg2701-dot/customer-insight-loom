/**
 * Scores the name rules on the planted name set, which was written before the rules. Shared by the unit test and the
 * comments screen, so the number on screen is the number the test checks.
 */
import { redact } from "./redact";
import { CLEAN_SENTENCES, PLANTED_NAMES } from "./testdata/planted-names";

export type NameCheck = {
  total: number;
  caught: number;
  clean: number;
  falseAlarms: number;
  rows: { id: string; variant: string; value: string; text: string; caught: boolean }[];
  falseAlarmSentences: string[];
};

/** Caught means a name finding covers the whole planted name. A false alarm is any name finding in a clean sentence. */
export function checkNames(): NameCheck {
  const rows = PLANTED_NAMES.map((item) => {
    const start = item.text.indexOf(item.value);
    const end = start + item.value.length;
    const names = redact(item.text).findings.filter((f) => f.type === "name");
    return { ...item, caught: names.some((f) => f.start <= start && f.end >= end) };
  });
  const falseAlarmSentences = CLEAN_SENTENCES.filter((s) => redact(s).findings.some((f) => f.type === "name"));
  return {
    total: rows.length,
    caught: rows.filter((r) => r.caught).length,
    clean: CLEAN_SENTENCES.length,
    falseAlarms: falseAlarmSentences.length,
    rows,
    falseAlarmSentences,
  };
}
