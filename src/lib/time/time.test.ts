import { describe, expect, it } from "vitest";
import { dailyCounts, isWindowOpen, localDayKey, parseLocalTime, withinWindow } from "./time";

const HOUR = 3_600_000;
const CHICAGO = "America/Chicago";

/** One event every hour, from startIso for the given number of hours. */
function hourly(startIso: string, hours: number): string[] {
  const start = Date.parse(startIso);
  return Array.from({ length: hours }, (_, i) => new Date(start + i * HOUR).toISOString());
}

describe("conversion window, plan section 5.8 and test 7", () => {
  const entry = "2026-03-01T12:00:00Z";

  it("counts a conversion at exactly 168 hours and refuses one second later", () => {
    const at168 = new Date(Date.parse(entry) + 168 * HOUR).toISOString();
    const after = new Date(Date.parse(entry) + 168 * HOUR + 1000).toISOString();
    expect(withinWindow(entry, at168, 168)).toBe(true);
    expect(withinWindow(entry, after, 168)).toBe(false);
  });

  it("is elapsed time, so a window that crosses the March 8 clock change does not shift", () => {
    // Entry Saturday March 7 at 12:00 in Chicago, which is 18:00 UTC. The clocks move forward overnight.
    const entryAt = "2026-03-07T18:00:00Z";
    const closing = new Date(Date.parse(entryAt) + 168 * HOUR);
    expect(closing.toISOString()).toBe("2026-03-14T18:00:00.000Z");
    expect(withinWindow(entryAt, closing.toISOString(), 168)).toBe(true);
    expect(withinWindow(entryAt, new Date(closing.getTime() + 1000).toISOString(), 168)).toBe(false);
    expect(localDayKey(closing.toISOString(), CHICAGO)).toBe("2026-03-14");
  });

  it("is elapsed time across the November 1 change too", () => {
    const entryAt = "2026-10-31T17:00:00Z";
    const closing = new Date(Date.parse(entryAt) + 168 * HOUR).toISOString();
    expect(closing).toBe("2026-11-07T17:00:00.000Z");
    expect(withinWindow(entryAt, closing, 168)).toBe(true);
  });

  it("refuses a conversion before the entry", () => {
    expect(withinWindow(entry, "2026-02-28T12:00:00Z", 168)).toBe(false);
  });

  it("is open until the closing instant has passed, and the closing instant counts as inside", () => {
    const closing = new Date(Date.parse(entry) + 168 * HOUR);
    expect(isWindowOpen(entry, 168, closing.toISOString())).toBe(true);
    expect(isWindowOpen(entry, 168, new Date(closing.getTime() + 1).toISOString())).toBe(false);
  });

  it("rejects a bad window or timestamp instead of guessing", () => {
    expect(() => withinWindow(entry, "later", 168)).toThrow(RangeError);
    expect(() => withinWindow(entry, entry, 0)).toThrow(RangeError);
    expect(() => withinWindow(entry, entry, Number.NaN)).toThrow(RangeError);
  });
});

describe("days are cut in the workspace zone, plan section 5.7 and test 6", () => {
  it("gives March 8, 2026 only 23 hours in Chicago, and keeps the neighbors at 24", () => {
    // 72 hourly events starting March 7 at 06:00 UTC, which is local midnight on March 7 in Chicago.
    const counts = dailyCounts(hourly("2026-03-07T06:00:00Z", 72), CHICAGO);
    expect(counts.get("2026-03-07")).toBe(24);
    expect(counts.get("2026-03-08")).toBe(23);
    expect(counts.get("2026-03-09")).toBe(24);
    // The last of the 72 events is the first hour of March 10, and nothing is lost or counted twice.
    expect(counts.get("2026-03-10")).toBe(1);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(72);
  });

  it("gives November 1, 2026 25 hours in Chicago", () => {
    // Starts October 31 at 05:00 UTC, which is local midnight on October 31 in Chicago.
    const counts = dailyCounts(hourly("2026-10-31T05:00:00Z", 74), CHICAGO);
    expect(counts.get("2026-10-31")).toBe(24);
    expect(counts.get("2026-11-01")).toBe(25);
    expect(counts.get("2026-11-02")).toBe(24);
  });

  it("cuts the same instants differently in another zone, so the zone setting matters", () => {
    const events = hourly("2026-03-07T06:00:00Z", 48);
    expect(dailyCounts(events, "UTC").get("2026-03-07")).toBe(18);
    expect(dailyCounts(events, CHICAGO).get("2026-03-07")).toBe(24);
  });

  it("excludes events with no usable timestamp and counts them for the data health report", () => {
    const counts = dailyCounts(["2026-03-07T12:00:00Z", "", "not a time"], CHICAGO);
    expect(counts.get("2026-03-07")).toBe(1);
    expect(counts.excluded).toBe(2);
  });
});

describe("a local time with no zone, plan section 5.7", () => {
  it("reads an ordinary local time as one instant", () => {
    expect(parseLocalTime("2026-03-07 12:00", CHICAGO)).toEqual({ status: "ok", instant: "2026-03-07T18:00:00.000Z" });
  });

  it("flags a local time that does not exist in the spring", () => {
    // At 02:00 on March 8, 2026 the clocks in Chicago jump to 03:00.
    expect(parseLocalTime("2026-03-08 02:30", CHICAGO)).toEqual({ status: "missing" });
  });

  it("flags a local time that occurs twice in the fall and returns both, earlier first", () => {
    // At 02:00 on November 1, 2026 the clocks fall back to 01:00, so 01:30 happens twice.
    expect(parseLocalTime("2026-11-01 01:30", CHICAGO)).toEqual({
      status: "ambiguous",
      instants: ["2026-11-01T06:30:00.000Z", "2026-11-01T07:30:00.000Z"],
    });
  });

  it("rejects text that is not a local time", () => {
    expect(parseLocalTime("yesterday", CHICAGO)).toEqual({ status: "invalid" });
    expect(parseLocalTime("2026-13-40 99:99", CHICAGO)).toEqual({ status: "invalid" });
  });
});

describe("speed, so a large file of events cannot freeze the page", () => {
  it("cuts 100,000 events into days in well under 2 seconds", () => {
    const events = Array.from({ length: 100_000 }, (_, i) => new Date(Date.parse("2026-01-01T00:00:00Z") + i * 1_000_000).toISOString());
    const started = performance.now();
    const counts = dailyCounts(events, CHICAGO);
    const ms = performance.now() - started;
    console.log(`dailyCounts on 100,000 events: ${ms.toFixed(0)} ms`);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(100_000);
    expect(ms).toBeLessThan(2000);
  });

  it("reads 20,000 local times with no zone in under 2 seconds", () => {
    const started = performance.now();
    for (let i = 0; i < 20_000; i++) {
      const day = String(1 + (i % 28)).padStart(2, "0");
      const hour = String(i % 24).padStart(2, "0");
      parseLocalTime(`2026-06-${day} ${hour}:30`, CHICAGO);
    }
    const ms = performance.now() - started;
    console.log(`parseLocalTime on 20,000 times: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(2000);
  });
});
