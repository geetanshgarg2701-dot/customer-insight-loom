import { parseLocalTime, withinWindow } from "../time/time";

/**
 * What the time rules say about one conversion time in a results file.
 *
 * - `in_window`: counted as converted.
 * - `after_window`: the person converted, but after the window closed. Counted as not converted in the window.
 * - `before_launch`: a conversion before the send cannot be caused by it. The person is left out.
 * - `impossible`: a local time the clocks skipped in the spring. It never happened. The person is left out.
 * - `ambiguous`: a local time the clocks showed twice in the autumn. It is not guessed. The person is left out.
 * - `unreadable`: not a time the app can read. The person is left out.
 * - `none`: no time was given. The person stays as the file says, and is counted.
 */
export type ConversionTime = "in_window" | "after_window" | "before_launch" | "impossible" | "ambiguous" | "unreadable" | "none";

export type TimeContext = {
  /** The instant the send went out. Everyone is taken to have entered the test then. */
  launchedAt: string;
  windowHours: number;
  /** The workspace time zone, used for times with no zone of their own. */
  timeZone: string;
};

/** A time that carries its own zone: Z, or an offset such as +05:30 or -0800. Fractions of a second are allowed. */
const ZONED = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/i;

/** The instant of a zoned time, or null when the date or time is not a real one (30 February is not rolled into March). */
function zonedInstant(text: string): string | null {
  const m = ZONED.exec(text);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
  const asUtc = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (
    asUtc.getUTCFullYear() !== y || asUtc.getUTCMonth() !== mo - 1 || asUtc.getUTCDate() !== d ||
    asUtc.getUTCHours() !== h || asUtc.getUTCMinutes() !== mi || asUtc.getUTCSeconds() !== s
  ) {
    return null;
  }
  let offset = 0;
  if (m[7].toUpperCase() !== "Z") {
    const digits = m[7].replace(":", "");
    const oh = Number(digits.slice(1, 3));
    const om = Number(digits.slice(3, 5));
    if (oh > 23 || om > 59) return null;
    offset = (digits[0] === "-" ? -1 : 1) * (oh * 60 + om);
  }
  const fraction = /\.(\d{1,9})/.exec(text.slice(0, text.length - m[7].length));
  const ms = fraction ? Math.floor(Number(`0.${fraction[1]}`) * 1000) : 0;
  return new Date(asUtc.getTime() - offset * 60_000 + ms).toISOString();
}

export function checkConversionTime(raw: string | null | undefined, ctx: TimeContext): ConversionTime {
  const text = (raw ?? "").trim();
  if (text === "") return "none";

  let instant: string;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const zoned = zonedInstant(text);
    if (zoned === null) return "unreadable";
    instant = zoned;
  } else {
    const local = parseLocalTime(text, ctx.timeZone);
    if (local.status === "missing") return "impossible";
    if (local.status === "ambiguous") return "ambiguous";
    if (local.status === "invalid") return "unreadable";
    instant = local.instant;
  }

  if (Date.parse(instant) < Date.parse(ctx.launchedAt)) return "before_launch";
  return withinWindow(ctx.launchedAt, instant, ctx.windowHours) ? "in_window" : "after_window";
}

/** What the readout reports about the time column, counted openly. */
export type TimeCounts = {
  /** Converters whose time was read and counted as inside the window. */
  inWindow: number;
  /** Converted after the window closed, so counted as not converted in the window. */
  afterWindow: number;
  beforeLaunch: number;
  impossible: number;
  ambiguous: number;
  unreadable: number;
  /** Converters with no time. They stay counted as converted. */
  noTime: number;
  timeZone: string;
};

export const emptyTimeCounts = (timeZone: string): TimeCounts => ({
  inWindow: 0,
  afterWindow: 0,
  beforeLaunch: 0,
  impossible: 0,
  ambiguous: 0,
  unreadable: 0,
  noTime: 0,
  timeZone,
});

/** Plain sentences for the counts that are not zero. Nothing is said about a count of zero. */
export function describeTimeCounts(c: TimeCounts): string[] {
  const out: string[] = [];
  const people = (n: number) => (n === 1 ? "1 person" : `${n.toLocaleString("en-US")} people`);
  out.push(`Conversion times were read in the ${c.timeZone} zone when a time had no zone of its own, and everyone is taken to have entered at launch.`);
  if (c.afterWindow > 0) out.push(`${people(c.afterWindow)} converted after the window closed, so they count as not converted in the window.`);
  if (c.beforeLaunch > 0) out.push(`${people(c.beforeLaunch)} converted before launch, so they were left out.`);
  if (c.impossible > 0) out.push(`${people(c.impossible)} had a time that never happened because the clocks skipped it, so they were left out.`);
  if (c.ambiguous > 0) out.push(`${people(c.ambiguous)} had a time that happened twice because the clocks went back, so they were left out.`);
  if (c.unreadable > 0) out.push(`${people(c.unreadable)} had a time that could not be read, so they were left out.`);
  if (c.noTime > 0) out.push(`${people(c.noTime)} converted with no time given, so they stay counted as converted.`);
  return out;
}
