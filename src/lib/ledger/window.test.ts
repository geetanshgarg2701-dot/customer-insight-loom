import { describe, expect, it } from "vitest";
import {
  MAX_WINDOW_HOURS,
  ReadoutLockedError,
  assertReadoutOpen,
  conversionWindowHours,
  isReadoutOpen,
  readoutOpensAt,
} from "./window";

const LAUNCHED = "2026-11-16T09:00:00.000Z";
const HOUR = 3_600_000;
const entry = (hours: unknown, launchedAt: string | null = LAUNCHED) => ({
  launchedAt,
  design: hours === undefined ? null : { conversionWindowHours: hours },
});

describe("conversionWindowHours", () => {
  it("reads a positive number of hours from the design", () => {
    expect(conversionWindowHours({ conversionWindowHours: 168 })).toBe(168);
    expect(conversionWindowHours({ conversionWindowHours: 0.5 })).toBe(0.5);
    expect(conversionWindowHours({ conversionWindowHours: MAX_WINDOW_HOURS })).toBe(MAX_WINDOW_HOURS);
  });

  it("returns null for anything that is not a usable window", () => {
    for (const design of [
      null,
      undefined,
      "168",
      {},
      { conversionWindowHours: 0 },
      { conversionWindowHours: -24 },
      { conversionWindowHours: "168" },
      { conversionWindowHours: Number.NaN },
      { conversionWindowHours: Number.POSITIVE_INFINITY },
      { conversionWindowHours: MAX_WINDOW_HOURS + 1 },
    ]) {
      expect(conversionWindowHours(design), JSON.stringify(design)).toBeNull();
    }
  });
});

describe("readoutOpensAt", () => {
  it("is the launch time plus the window", () => {
    expect(readoutOpensAt(entry(168))?.toISOString()).toBe("2026-11-23T09:00:00.000Z");
    expect(readoutOpensAt(entry(1.5))?.toISOString()).toBe("2026-11-16T10:30:00.000Z");
  });

  it("does not exist before launch or without a window", () => {
    expect(readoutOpensAt(entry(168, null))).toBeNull();
    expect(readoutOpensAt(entry(undefined))).toBeNull();
  });
});

describe("isReadoutOpen", () => {
  const e = entry(168);
  const close = Date.parse(LAUNCHED) + 168 * HOUR;

  it("is closed through the closing instant, because a conversion at that instant still counts", () => {
    expect(isReadoutOpen(e, new Date(close - 1))).toBe(false);
    expect(isReadoutOpen(e, new Date(close))).toBe(false);
  });

  it("opens one millisecond after the window closes", () => {
    expect(isReadoutOpen(e, new Date(close + 1))).toBe(true);
  });

  it("is closed for an entry that has not launched or has no window", () => {
    expect(isReadoutOpen(entry(168, null), new Date("2030-01-01"))).toBe(false);
    expect(isReadoutOpen(entry(undefined), new Date("2030-01-01"))).toBe(false);
  });
});

describe("assertReadoutOpen", () => {
  it("throws a locked error that names the unlock time and gives the reason", () => {
    const e = entry(168);
    let error: unknown;
    try {
      assertReadoutOpen(e, new Date("2026-11-19T09:00:00.000Z"));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ReadoutLockedError);
    expect((error as ReadoutLockedError).opensAt).toBe("2026-11-23T09:00:00.000Z");
    expect((error as Error).message).toContain("2026-11-23T09:00:00.000Z");
    expect((error as Error).message).toMatch(/168 hour conversion window/);
    expect((error as Error).message).not.toContain(String.fromCharCode(0x2014));
  });

  it("explains an entry that has not launched", () => {
    expect(() => assertReadoutOpen(entry(168, null), new Date())).toThrow(/not launched/i);
  });

  it("explains an entry with no conversion window", () => {
    expect(() => assertReadoutOpen(entry(undefined), new Date())).toThrow(/conversion window/i);
  });

  it("passes once the window has closed", () => {
    expect(() => assertReadoutOpen(entry(168), new Date("2026-11-23T09:00:00.001Z"))).not.toThrow();
  });
});
