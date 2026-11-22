import { describe, expect, it } from "vitest";
import { checkConversionTime, describeTimeCounts, emptyTimeCounts, type TimeContext } from "./conversion-time";

/** Launch at 12:00 UTC on 2026-03-01, a 7 day window (168 hours), a zone that changes its clocks. */
const ctx: TimeContext = { launchedAt: "2026-03-01T12:00:00.000Z", windowHours: 168, timeZone: "America/New_York" };

describe("one conversion time against launch and the window", () => {
  it("counts a time inside the window", () => {
    expect(checkConversionTime("2026-03-03T09:00:00Z", ctx)).toBe("in_window");
  });
  it("counts the closing instant as inside and the next second as after", () => {
    expect(checkConversionTime("2026-03-08T12:00:00Z", ctx)).toBe("in_window");
    expect(checkConversionTime("2026-03-08T12:00:01Z", ctx)).toBe("after_window");
  });
  it("counts launch itself as inside and the second before as before launch", () => {
    expect(checkConversionTime("2026-03-01T12:00:00Z", ctx)).toBe("in_window");
    expect(checkConversionTime("2026-03-01T11:59:59Z", ctx)).toBe("before_launch");
  });
  it("reads an offset, so the same instant gives the same answer in any zone", () => {
    expect(checkConversionTime("2026-03-01T07:00:00-05:00", ctx)).toBe("in_window");
    expect(checkConversionTime("2026-03-01T06:59:59-05:00", ctx)).toBe("before_launch");
    expect(checkConversionTime("2026-03-01T17:30:00+05:30", ctx)).toBe("in_window");
  });
  it("reads a time with no zone in the workspace zone", () => {
    // 07:00 in New York on 1 March is 12:00 UTC, launch itself.
    expect(checkConversionTime("2026-03-01 07:00:00", ctx)).toBe("in_window");
    expect(checkConversionTime("2026-03-01 06:59:00", ctx)).toBe("before_launch");
  });
  it("says a time the clocks skipped is impossible, not guessed", () => {
    // 2026-03-08 02:30 does not exist in New York: the clocks jump from 02:00 to 03:00.
    expect(checkConversionTime("2026-03-08 02:30:00", ctx)).toBe("impossible");
  });
  it("says a time the clocks showed twice is ambiguous, not guessed", () => {
    const fall: TimeContext = { launchedAt: "2026-11-01T00:00:00.000Z", windowHours: 168, timeZone: "America/New_York" };
    // 2026-11-01 01:30 happens twice in New York.
    expect(checkConversionTime("2026-11-01 01:30:00", fall)).toBe("ambiguous");
  });
  it("leaves a blank as none, and text that is not a time as unreadable", () => {
    expect(checkConversionTime("", ctx)).toBe("none");
    expect(checkConversionTime("   ", ctx)).toBe("none");
    expect(checkConversionTime(null, ctx)).toBe("none");
    expect(checkConversionTime(undefined, ctx)).toBe("none");
    expect(checkConversionTime("last tuesday", ctx)).toBe("unreadable");
    expect(checkConversionTime("2026-13-45 99:00", ctx)).toBe("unreadable");
    expect(checkConversionTime("2026-02-30T10:00:00Z", ctx)).toBe("unreadable");
    expect(checkConversionTime("2026-03-02T10:00:00+25:00", ctx)).toBe("unreadable");
    expect(checkConversionTime("2026-03-02T24:30:00Z", ctx)).toBe("unreadable");
  });
  it("uses elapsed hours, so a clock change inside the window does not move the close", () => {
    // Launch 2026-03-07 12:00 UTC. The New York clocks change on 8 March. The window still closes 168 hours later.
    const c: TimeContext = { launchedAt: "2026-03-07T12:00:00.000Z", windowHours: 168, timeZone: "America/New_York" };
    expect(checkConversionTime("2026-03-14T12:00:00Z", c)).toBe("in_window");
    expect(checkConversionTime("2026-03-14T12:00:01Z", c)).toBe("after_window");
  });
});

describe("the sentences about the time counts", () => {
  it("says only what happened, and names the zone", () => {
    const counts = { ...emptyTimeCounts("America/New_York"), afterWindow: 3, beforeLaunch: 1, ambiguous: 2 };
    const text = describeTimeCounts(counts).join(" ");
    expect(text).toContain("America/New_York");
    expect(text).toContain("3 people converted after the window closed, so they count as not converted in the window.");
    expect(text).toContain("1 person converted before launch, so they were left out.");
    expect(text).toContain("2 people had a time that happened twice because the clocks went back, so they were left out.");
    expect(text).not.toContain("never happened");
    expect(text).not.toContain("could not be read");
    expect(text).not.toContain("no time given");
  });
});
