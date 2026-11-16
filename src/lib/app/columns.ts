/** Index of the first header that matches the pattern, or -1. Used to pre-select a column. */
export function guessColumn(headers: readonly string[], pattern: RegExp): number {
  return headers.findIndex((name) => pattern.test(name));
}
