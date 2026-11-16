import { detectAll } from "./detectors";

/**
 * Column-level block list. A column that looks like an identity field must
 * never feed quote storage, whatever its values look like.
 *
 * Fails closed: it may block a harmless column such as "ip_address" or
 * "email_sent_count". Blocking too much is the safe direction here.
 * "name" alone is blocked, and "name" with a person word (first, last,
 * customer, ...). Names such as campaign_name or product_name are allowed.
 */

/** The message and fields never hold the column text, which may itself be personal data. */
export class BlockedColumnError extends Error {
  constructor() {
    super("A column was refused because it looks like an identity column.");
    this.name = "BlockedColumnError";
  }
}

const BLOCKED_TOKENS = new Set([
  "email", "emails", "mail",
  "phone", "phones", "mobile", "cell", "telephone", "tel", "fax",
  "address", "addr", "street", "zip", "zipcode", "postcode", "postal",
  "ssn", "dob", "birthday", "birthdate",
  "firstname", "lastname", "fullname", "middlename", "givenname",
  "familyname", "surname", "username", "nickname",
]);

/** With the token "name", these make it a person's name. */
const PERSON_WORDS = new Set([
  "first", "last", "full", "middle", "given", "family", "sur", "maiden",
  "nick", "customer", "contact", "user", "person", "client", "buyer",
  "billing", "shipping", "display", "legal", "recipient", "sender",
]);

function tokens(column: string): string[] {
  return column
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function isBlockedColumn(column: string): boolean {
  // A header that is really data, such as an email address in a file with no
  // header row, is blocked whatever its words are.
  if (detectAll(column).length > 0) return true;
  const t = tokens(column);
  if (t.length === 0) return true; // unreadable name: fail closed
  if (t.join("") === "email") return true; // e-mail
  if (t.some((x) => BLOCKED_TOKENS.has(x))) return true;
  if (t.includes("name")) {
    return t.length === 1 || t.some((x) => PERSON_WORDS.has(x));
  }
  return false;
}

export function assertColumnAllowed(column: string): void {
  if (isBlockedColumn(column)) throw new BlockedColumnError();
}

export function partitionColumns(columns: readonly string[]): {
  allowed: string[];
  blocked: string[];
} {
  const allowed: string[] = [];
  const blocked: string[] = [];
  for (const c of columns) (isBlockedColumn(c) ? blocked : allowed).push(c);
  return { allowed, blocked };
}

export function dropBlockedColumns<T>(row: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!isBlockedColumn(key)) out[key] = value;
  }
  return out;
}
