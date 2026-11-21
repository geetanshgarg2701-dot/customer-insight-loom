import { describe, expect, it } from "vitest";
import {
  RETENTION_MINUTES,
  WARN_SECONDS,
  leftText,
  retentionStatus,
  startRetention,
  touchRetention,
  type RetentionState,
} from "./retention";

const MIN = 60_000;
const T0 = 1_000_000;

describe("starting the timer", () => {
  it("offers 15, 30, 60 and 120 minutes", () => {
    expect([...RETENTION_MINUTES]).toEqual([15, 30, 60, 120]);
  });

  it("starts at the time given, and refuses any other length", () => {
    expect(startRetention(30, T0)).toEqual({ minutes: 30, lastActivity: T0 });
    expect(() => startRetention(7, T0)).toThrow(RangeError);
    expect(() => startRetention(0, T0)).toThrow(RangeError);
    expect(() => startRetention(Number.NaN, T0)).toThrow(RangeError);
    expect(() => startRetention(30, Number.NaN)).toThrow(RangeError);
  });
});

describe("what the timer says", () => {
  const s = startRetention(15, T0) as RetentionState;

  it("is off with no timer", () => {
    expect(retentionStatus(null, T0)).toEqual({ phase: "off" });
  });

  it("counts the seconds left, rounding up, while there is time", () => {
    expect(retentionStatus(s, T0)).toEqual({ phase: "counting", secondsLeft: 900 });
    expect(retentionStatus(s, T0 + 1)).toEqual({ phase: "counting", secondsLeft: 900 });
    expect(retentionStatus(s, T0 + 5 * MIN)).toEqual({ phase: "counting", secondsLeft: 600 });
    expect(retentionStatus(s, T0 + 15 * MIN - (WARN_SECONDS + 1) * 1000)).toEqual({ phase: "counting", secondsLeft: WARN_SECONDS + 1 });
  });

  it("warns for the last minute", () => {
    expect(WARN_SECONDS).toBe(60);
    expect(retentionStatus(s, T0 + 15 * MIN - 60_000)).toEqual({ phase: "warning", secondsLeft: 60 });
    expect(retentionStatus(s, T0 + 15 * MIN - 1500)).toEqual({ phase: "warning", secondsLeft: 2 });
  });

  it("has expired at the deadline and after it", () => {
    expect(retentionStatus(s, T0 + 15 * MIN)).toEqual({ phase: "expired", secondsLeft: 0 });
    expect(retentionStatus(s, T0 + 15 * MIN + 10 * MIN)).toEqual({ phase: "expired", secondsLeft: 0 });
  });

  it("does not run early if the clock is set back", () => {
    expect(retentionStatus(s, T0 - 5 * MIN)).toEqual({ phase: "counting", secondsLeft: 900 });
  });
});

describe("activity", () => {
  it("moves the deadline from the time of the activity", () => {
    const s = startRetention(15, T0) as RetentionState;
    const later = touchRetention(s, T0 + 10 * MIN) as RetentionState;
    expect(later).toEqual({ minutes: 15, lastActivity: T0 + 10 * MIN });
    expect(retentionStatus(later, T0 + 10 * MIN)).toEqual({ phase: "counting", secondsLeft: 900 });
  });

  it("brings a warning back to counting", () => {
    const s = startRetention(15, T0) as RetentionState;
    const t = T0 + 14.5 * MIN;
    expect(retentionStatus(s, t).phase).toBe("warning");
    expect(retentionStatus(touchRetention(s, t), t).phase).toBe("counting");
  });

  it("cannot bring back a timer that has already expired", () => {
    const s = startRetention(15, T0) as RetentionState;
    const t = T0 + 16 * MIN;
    expect(touchRetention(s, t)).toBe(s);
    expect(retentionStatus(touchRetention(s, t), t).phase).toBe("expired");
  });

  it("does nothing when there is no timer, and never goes backwards", () => {
    expect(touchRetention(null, T0)).toBeNull();
    const s = { minutes: 15, lastActivity: T0 + 5 * MIN } as RetentionState;
    expect(touchRetention(s, T0)).toBe(s);
  });
});

describe("the words for the time left", () => {
  it.each([
    [900, "15 minutes"],
    [121, "3 minutes"],
    [120, "2 minutes"],
    [61, "2 minutes"],
    [60, "60 seconds"],
    [59, "59 seconds"],
    [1, "1 second"],
  ])("%i seconds reads %s", (seconds, text) => {
    expect(leftText(seconds)).toBe(text);
  });
});
