import { BlockedColumnError, assertColumnAllowed } from "../redaction/columns";
import { MappingError } from "./errors";
import type { Header, MappingEntry } from "./types";

export const MAX_TARGET_LENGTH = 128;

/**
 * Starting point for the mapping screen. Blocked columns start unchecked.
 * Duplicate and blank header names get unique target names.
 */
export function defaultMapping(headers: readonly Header[]): MappingEntry[] {
  const used = new Set<string>();
  return headers.map((h) => {
    const base = h.name.trim() || `column_${h.index + 1}`;
    let target = base;
    let n = 2;
    while (used.has(target.toLowerCase())) target = `${base}_${n++}`;
    used.add(target.toLowerCase());
    return { source: h.index, target, include: !h.blocked };
  });
}

/**
 * Throws if the mapping may not be loaded. The blocked check runs the shared
 * redaction rule on the header name and on the new name, and it also honors the
 * blocked flag the intake set from the original header text.
 */
export function validateMapping(
  headers: readonly Header[],
  mapping: readonly MappingEntry[],
): void {
  const seen = new Set<string>();
  let included = 0;
  for (const entry of mapping) {
    if (!entry.include) continue;
    const header = Number.isInteger(entry.source) ? headers[entry.source] : undefined;
    if (!header) throw new MappingError(`Source column ${entry.source} does not exist.`);
    // The stored flag comes from the original text, which a masked name no
    // longer shows, so it is checked as well as the shared rule on the name.
    if (header.blocked) throw new BlockedColumnError();
    assertColumnAllowed(header.name);

    const target = entry.target.trim();
    if (!target) throw new MappingError("Every loaded column needs a name.");
    if (target.length > MAX_TARGET_LENGTH) {
      throw new MappingError(`Column names can have at most ${MAX_TARGET_LENGTH} characters.`);
    }
    assertColumnAllowed(target);

    const key = target.toLowerCase();
    if (seen.has(key)) throw new MappingError(`Two columns are named "${target}".`);
    seen.add(key);
    included++;
  }
  if (included === 0) throw new MappingError("Choose at least one column to load.");
}
