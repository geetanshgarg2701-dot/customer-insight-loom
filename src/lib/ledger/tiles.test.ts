import { describe, expect, it } from "vitest";
import { STATUSES, type EntryStatus } from "./ledger";
import { ledgerTiles } from "./tiles";

const at = (statuses: EntryStatus[]) => statuses.map((status) => ({ status }));

describe("ledger tiles", () => {
  it("splits the entries by where they stand, worked out by hand", () => {
    // 2 drafts, 3 registered or running (1 registered, 2 running), and 4 ready to read or closed (1 readable, 3 closed): 9.
    const t = ledgerTiles(at(["draft", "draft", "registered", "running", "running", "readable", "closed", "closed", "closed"]));
    expect(t).toEqual({ entries: 9, drafts: 2, underway: 3, finished: 4 });
  });

  it("always adds up, whatever the mix", () => {
    for (let mask = 0; mask < 5 ** 5; mask += 7) {
      const list: EntryStatus[] = [];
      for (let i = 0, m = mask; i < 5; i++, m = Math.floor(m / 5)) list.push(STATUSES[m % 5]);
      const t = ledgerTiles(at(list));
      expect(t.drafts + t.underway + t.finished).toBe(t.entries);
      expect(t.entries).toBe(list.length);
    }
  });

  it("counts every status in exactly one place", () => {
    for (const s of STATUSES) {
      const t = ledgerTiles(at([s]));
      expect(t.drafts + t.underway + t.finished, s).toBe(1);
    }
  });

  it("gives zeros for an empty ledger", () => {
    expect(ledgerTiles([])).toEqual({ entries: 0, drafts: 0, underway: 0, finished: 0 });
  });
});
