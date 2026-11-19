import { describe, expect, it } from "vitest";
import { createCycle, runWhileCurrent } from "./latest";

describe("createCycle", () => {
  it("counts up, and only the newest start is current", () => {
    const c = createCycle();
    const a = c.start();
    expect(c.isCurrent(a)).toBe(true);
    const b = c.start();
    expect(b).toBeGreaterThan(a);
    expect(c.isCurrent(a)).toBe(false);
    expect(c.isCurrent(b)).toBe(true);
  });
});

describe("runWhileCurrent", () => {
  it("runs every task in order while nothing newer has started", async () => {
    const c = createCycle();
    const id = c.start();
    const log: string[] = [];
    await runWhileCurrent(c, id, [async () => void log.push("a"), async () => void log.push("b"), async () => void log.push("c")]);
    expect(log).toEqual(["a", "b", "c"]);
  });

  it("stops before the next task once a newer cycle has started, so stale queries are never sent", async () => {
    const c = createCycle();
    const id = c.start();
    const log: string[] = [];
    await runWhileCurrent(c, id, [
      async () => void log.push("a"),
      async () => {
        log.push("b");
        c.start(); // a click arrives while b is running
      },
      async () => void log.push("c"),
      async () => void log.push("d"),
    ]);
    expect(log).toEqual(["a", "b"]);
  });

  it("lets the newer cycle run in full", async () => {
    const c = createCycle();
    const old = c.start();
    const fresh = c.start();
    const log: string[] = [];
    await runWhileCurrent(c, old, [async () => void log.push("old")]);
    await runWhileCurrent(c, fresh, [async () => void log.push("new1"), async () => void log.push("new2")]);
    expect(log).toEqual(["new1", "new2"]);
  });

  it("passes an error from a task to the caller and stops the rest", async () => {
    const c = createCycle();
    const id = c.start();
    const log: string[] = [];
    await expect(
      runWhileCurrent(c, id, [async () => void log.push("a"), async () => { throw new Error("boom"); }, async () => void log.push("c")]),
    ).rejects.toThrow("boom");
    expect(log).toEqual(["a"]);
  });
});
