/**
 * The fixed horizon rule, plan section 6.2: a result unlocks only after the
 * conversion window closes. Reading earlier is peeking. Five equally spaced
 * looks at an A/A test raised the false positive rate from 5.4 percent to
 * 14.2 percent in the 2026-11-16 review, so the app refuses early reads
 * instead of asking people to hold back.
 *
 * The closing instant counts as inside the window, as Part A section 5.8
 * says, so the readout opens one millisecond after it.
 */

const HOUR_MS = 3_600_000;

/** One year. A longer window is almost certainly a typing mistake. */
export const MAX_WINDOW_HOURS = 24 * 365;

type Launchable = { launchedAt: string | null; design: unknown };

/** The window in hours from a design, or null when the design has no usable window. */
export function conversionWindowHours(design: unknown): number | null {
  if (typeof design !== "object" || design === null) return null;
  const hours = (design as Record<string, unknown>).conversionWindowHours;
  if (typeof hours !== "number" || !Number.isFinite(hours)) return null;
  return hours > 0 && hours <= MAX_WINDOW_HOURS ? hours : null;
}

/** When the readout may open, or null before launch or without a window. */
export function readoutOpensAt(entry: Launchable): Date | null {
  const hours = conversionWindowHours(entry.design);
  if (hours === null || entry.launchedAt === null) return null;
  const launched = Date.parse(entry.launchedAt);
  if (Number.isNaN(launched)) return null;
  return new Date(launched + hours * HOUR_MS);
}

export function isReadoutOpen(entry: Launchable, now: Date): boolean {
  const opens = readoutOpensAt(entry);
  return opens !== null && now.getTime() > opens.getTime();
}

export class ReadoutLockedError extends Error {
  constructor(
    message: string,
    public readonly opensAt: string | null,
  ) {
    super(message);
    this.name = "ReadoutLockedError";
  }
}

export function assertReadoutOpen(entry: Launchable, now: Date): void {
  if (entry.launchedAt === null) {
    throw new ReadoutLockedError("This entry has not launched, so there is no result to read yet.", null);
  }
  const hours = conversionWindowHours(entry.design);
  if (hours === null) {
    throw new ReadoutLockedError(
      "This entry has no conversion window in its design, so the readout cannot unlock.",
      null,
    );
  }
  const opens = readoutOpensAt(entry)!;
  if (now.getTime() <= opens.getTime()) {
    const iso = opens.toISOString();
    throw new ReadoutLockedError(
      `Results unlock at ${iso}, when the ${hours} hour conversion window closes. ` +
        `Reading results earlier is peeking, and it raises the false positive rate.`,
      iso,
    );
  }
}
