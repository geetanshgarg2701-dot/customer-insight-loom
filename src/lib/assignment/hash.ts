/**
 * Keyed hashing for assignment, plan section 6.2, using Web Crypto, which the
 * browser and Node both provide. No dependency.
 *
 * Note on the plan: the bucket mixes in the entry id, so one person lands in
 * independent groups across experiments. Without it, the same customers
 * would sit in every control group at once.
 */

/**
 * Plan section 5.5: trim spaces, apply Unicode normalization, lower case, and nothing else. Dots and plus tags are
 * left alone, because removing them is a guess. Normalization comes first so a full width or non breaking space
 * form lands on the same address as the plain one.
 */
export function normalizeEmail(raw: string): string {
  return raw.normalize("NFKC").trim().toLowerCase();
}

/** A cell that starts with one of these can be run as a formula by a spreadsheet. */
export const FORMULA_START = /^[=+\-@\t\r]/;

/** Undoes only the protection csvCell adds, a leading quote on a cell that starts like a formula. */
export function unprotect(value: string): string {
  return value.length > 1 && value[0] === "'" && FORMULA_START.test(value.slice(1)) ? value.slice(1) : value;
}

/** A deliberately loose shape check: one at sign, no spaces. */
export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(email);
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) throw new RangeError("The secret must be hex.");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secretHex: string): Promise<CryptoKey> {
  let key = keyCache.get(secretHex);
  if (!key) {
    key = crypto.subtle.importKey(
      "raw",
      hexToBytes(secretHex) as BufferSource,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    keyCache.set(secretHex, key);
  }
  return key;
}

async function hmac(secretHex: string, message: string): Promise<ArrayBuffer> {
  return crypto.subtle.sign("HMAC", await hmacKey(secretHex), new TextEncoder().encode(message));
}

/** HMAC SHA-256 of a message under a hex key, as hex. */
export async function hmacHex(secretHex: string, message: string): Promise<string> {
  return toHex(await hmac(secretHex, message));
}

/** The only identity the app keeps: a keyed hash of the normalized email. */
export function customerHash(secretHex: string, email: string): Promise<string> {
  return hmacHex(secretHex, `customer:${normalizeEmail(email)}`);
}

/** A bucket from 0 to 99, fixed for this person in this entry. */
export async function bucketOf(secretHex: string, entryId: string, hash: string): Promise<number> {
  const bytes = new Uint8Array(await hmac(secretHex, `assign:${entryId}:${hash}`));
  const u32 = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return Math.floor((u32 * 100) / 2 ** 32);
}
