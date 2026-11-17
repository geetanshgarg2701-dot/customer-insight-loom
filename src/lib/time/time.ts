/**
 * Time rules, plan sections 5.7 and 5.8. Every timestamp is a UTC instant. A conversion window is elapsed time, so
 * a 7 day window is 168 hours and a clock change cannot move it. Days are cut in the workspace time zone with the
 * zone database, never by adding a fixed number of hours.
 */

const HOUR_MS = 3_600_000;

function instant(value: string, label: string): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new RangeError(`The ${label} is not a time.`);
  return ms;
}

function checkHours(hours: number): void {
  if (!Number.isFinite(hours) || hours <= 0) throw new RangeError("The window must be a number of hours above 0.");
}

/** True when the conversion happened at or after entry and no later than the window's closing instant. */
export function withinWindow(entryAt: string, convertedAt: string, windowHours: number): boolean {
  checkHours(windowHours);
  const entry = instant(entryAt, "entry time");
  const converted = instant(convertedAt, "conversion time");
  return converted >= entry && converted <= entry + windowHours * HOUR_MS;
}

/**
 * Still open at the data cutoff. The closing instant counts as inside, so the window is open through it and closed
 * one millisecond later. An open customer is left out of the rate and shown as their own count.
 */
export function isWindowOpen(entryAt: string, windowHours: number, cutoffAt: string): boolean {
  checkHours(windowHours);
  return instant(cutoffAt, "cutoff") <= instant(entryAt, "entry time") + windowHours * HOUR_MS;
}

/**
 * Building an Intl formatter costs about 60 microseconds, and it was being built for every event, which made cutting
 * 100,000 events into days take over 6 seconds. Each zone's formatter is built once and kept. A name the zone database
 * does not know throws on the first use and is not kept, so a bad name cannot poison the cache.
 */
const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(cache: Map<string, Intl.DateTimeFormat>, timeZone: string, options: Intl.DateTimeFormatOptions) {
  let f = cache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, ...options });
    cache.set(timeZone, f);
  }
  return f;
}

/** The calendar date of an instant in the named zone, as YYYY-MM-DD. */
export function localDayKey(isoInstant: string, timeZone: string): string {
  const ms = instant(isoInstant, "time");
  let year = "";
  let month = "";
  let day = "";
  for (const p of formatterFor(dayFormatters, timeZone, { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms))) {
    if (p.type === "year") year = p.value;
    else if (p.type === "month") month = p.value;
    else if (p.type === "day") day = p.value;
  }
  return `${year}-${month}-${day}`;
}

/** Counts per local day. Events with no usable timestamp are left out and counted in `excluded`. */
export class DailyCounts extends Map<string, number> {
  excluded = 0;
}

export function dailyCounts(timestamps: readonly string[], timeZone: string): DailyCounts {
  const out = new DailyCounts();
  for (const t of timestamps) {
    if (!Number.isFinite(Date.parse(t))) {
      out.excluded++;
      continue;
    }
    const day = localDayKey(t, timeZone);
    out.set(day, (out.get(day) ?? 0) + 1);
  }
  return out;
}

/** The zone's offset from UTC at an instant, in minutes. */
function offsetMinutes(timeZone: string, ms: number): number {
  const name =
    formatterFor(offsetFormatters, timeZone, { timeZoneName: "longOffset", hour: "numeric" })
      .formatToParts(new Date(ms))
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!m) return 0;
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === "-" ? -minutes : minutes;
}

export type LocalTime =
  | { status: "ok"; instant: string }
  /** The clocks jumped over this time in the spring. It never happened. */
  | { status: "missing" }
  /** The clocks fell back, so this time happened twice. Both instants, earlier first. */
  | { status: "ambiguous"; instants: [string, string] }
  | { status: "invalid" };

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * An upload time with no zone, read in the workspace zone. A time that does not exist or that happens twice is
 * flagged, never guessed, so the person can decide how to treat it.
 */
export function parseLocalTime(text: string, timeZone: string): LocalTime {
  const m = LOCAL.exec(text.trim());
  if (!m) return { status: "invalid" };
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const back = new Date(asUtc);
  const real =
    back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d &&
    back.getUTCHours() === h && back.getUTCMinutes() === mi && back.getUTCSeconds() === s;
  if (!real) return { status: "invalid" };

  // The zone has at most two offsets within a day of this time. Try each, and keep the ones that agree with themselves.
  const offsets = new Set([offsetMinutes(timeZone, asUtc - 24 * HOUR_MS), offsetMinutes(timeZone, asUtc + 24 * HOUR_MS)]);
  const valid = [...offsets]
    .map((o) => asUtc - o * 60_000)
    .filter((t) => offsetMinutes(timeZone, t) === (asUtc - t) / 60_000)
    .sort((a, b) => a - b);
  if (valid.length === 0) return { status: "missing" };
  if (valid.length === 1) return { status: "ok", instant: new Date(valid[0]).toISOString() };
  return { status: "ambiguous", instants: [new Date(valid[0]).toISOString(), new Date(valid[1]).toISOString()] };
}
