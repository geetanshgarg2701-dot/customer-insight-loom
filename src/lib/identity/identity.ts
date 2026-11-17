import { looksLikeEmail, normalizeEmail, unprotect } from "../assignment/hash";

/**
 * Identity matching, plan section 5.5. Version 1 matches on the normalized email only, exact match. Dots and plus
 * tags are never merged, because removing them is a guess. An address that differs only by a plus tag is listed as a
 * possible pair for the person to inspect, and is not merged.
 */

export type IdentityReport = {
  /** Every non empty record in both sources, repeats and invalid ones included. */
  records: number;
  /** Distinct customers across both sources, after matching. */
  customers: number;
  /** In both sources. */
  matched: string[];
  unmatchedLeft: string[];
  unmatchedRight: string[];
  /** Repeats inside one source, dropped so each person counts once. */
  duplicatesLeft: number;
  duplicatesRight: number;
  /** Values that are not email addresses. They are in no list. */
  invalidLeft: number;
  invalidRight: number;
  /** Unmatched pairs that differ only by a plus tag. Not merged. */
  possiblePairs: { left: string; right: string }[];
};

type Cleaned = { unique: string[]; duplicates: number; invalid: number; records: number };

function clean(values: readonly string[]): Cleaned {
  const seen = new Set<string>();
  const unique: string[] = [];
  let duplicates = 0;
  let invalid = 0;
  for (const raw of values) {
    const email = normalizeEmail(unprotect(raw));
    if (!looksLikeEmail(email)) {
      invalid++;
      continue;
    }
    if (seen.has(email)) {
      duplicates++;
      continue;
    }
    seen.add(email);
    unique.push(email);
  }
  return { unique, duplicates, invalid, records: values.length };
}

/** The address with any plus tag taken out of the local part, used only to suggest pairs. */
function withoutPlusTag(email: string): string {
  const at = email.lastIndexOf("@");
  const local = email.slice(0, at);
  const plus = local.indexOf("+");
  return plus < 0 ? email : `${local.slice(0, plus)}${email.slice(at)}`;
}

export function matchIdentities(input: { left: readonly string[]; right: readonly string[] }): IdentityReport {
  const left = clean(input.left);
  const right = clean(input.right);
  const rightSet = new Set(right.unique);
  const leftSet = new Set(left.unique);

  const matched = left.unique.filter((e) => rightSet.has(e));
  const unmatchedLeft = left.unique.filter((e) => !rightSet.has(e));
  const unmatchedRight = right.unique.filter((e) => !leftSet.has(e));

  // Suggest a pair only when the two differ by a plus tag and nothing else.
  const byBase = new Map<string, string[]>();
  for (const e of unmatchedRight) byBase.set(withoutPlusTag(e), [...(byBase.get(withoutPlusTag(e)) ?? []), e]);
  const possiblePairs: { left: string; right: string }[] = [];
  for (const l of unmatchedLeft) {
    for (const r of byBase.get(withoutPlusTag(l)) ?? []) possiblePairs.push({ left: l, right: r });
  }

  return {
    records: left.records + right.records,
    customers: left.unique.length + right.unique.length - matched.length,
    matched,
    unmatchedLeft,
    unmatchedRight,
    duplicatesLeft: left.duplicates,
    duplicatesRight: right.duplicates,
    invalidLeft: left.invalid,
    invalidRight: right.invalid,
    possiblePairs,
  };
}

/** For showing a list without showing addresses: the first letter and the domain. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}
