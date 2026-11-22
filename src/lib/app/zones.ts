/** Time zone names from the browser's zone database. */
export function zones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
}

/** The person's own zone when the database knows it, else UTC. */
export function localZone(list: string[]): string {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return list.includes(z) ? z : "UTC";
  } catch {
    return "UTC";
  }
}
