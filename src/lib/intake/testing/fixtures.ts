const encoder = new TextEncoder();

export function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

export function bytesWithBom(text: string): Uint8Array {
  const body = encoder.encode(text);
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf], 0);
  out.set(body, 3);
  return out;
}

/** Joins rows with LF and ends with a newline. */
export function lines(...rows: string[]): string {
  return rows.join("\n") + "\n";
}
