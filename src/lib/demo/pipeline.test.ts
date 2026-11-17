import { describe, expect, it } from "vitest";
import { PIPELINE_AS_OF, PIPELINE_CHANGE_AT, PIPELINE_STAGES, syntheticPipeline } from "./pipeline";

const DAY = 86_400_000;

describe("syntheticPipeline", () => {
  const rows = syntheticPipeline(30_000, 5);

  it("is identical for the same seed and different for another", () => {
    expect(syntheticPipeline(300, 1)).toEqual(syntheticPipeline(300, 1));
    expect(syntheticPipeline(300, 1)).not.toEqual(syntheticPipeline(300, 2));
  });

  it("starts everyone in the first stage, in order, and never moves a stage into the future", () => {
    const asOf = Date.parse(PIPELINE_AS_OF);
    for (const r of rows) {
      expect(r.entered[0]).not.toBeNull();
      const reached = r.entered.filter((e) => e !== null) as string[];
      expect(r.entered.slice(0, reached.length).every((e) => e !== null)).toBe(true);
      expect(r.entered.slice(reached.length).every((e) => e === null)).toBe(true);
      const times = reached.map((e) => Date.parse(e.replace(" ", "T") + "Z"));
      for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
      expect(times[times.length - 1]).toBeLessThanOrEqual(asOf);
      expect(r.stage).toBe(PIPELINE_STAGES[reached.length - 1]);
    }
  });

  it("writes every time as UTC text without a zone, the form the database reads", () => {
    for (const r of rows.slice(0, 500)) {
      for (const e of r.entered) if (e !== null) expect(e).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    }
  });

  it("plants a known fact: enterprise deals sit in Proposal far longer than small ones", () => {
    const days = (segment: string) => {
      const d = rows
        .filter((r) => r.segment === segment && r.entered[2] && r.entered[3])
        .map((r) => (Date.parse(r.entered[3]!.replace(" ", "T") + "Z") - Date.parse(r.entered[2]!.replace(" ", "T") + "Z")) / DAY)
        .sort((a, b) => a - b);
      return d[Math.floor(d.length / 2)];
    };
    expect(days("enterprise")).toBeGreaterThan(days("smb") * 2);
  });

  it("marks a deal won, lost or open, and a lost deal went quiet before the cutoff", () => {
    const asOf = Date.parse(PIPELINE_AS_OF);
    const utc = (t: string) => Date.parse(t.replace(" ", "T") + "Z");
    let lost = 0;
    for (const r of rows) {
      if (r.stage === "Won") {
        expect(r.status).toBe("won");
        expect(r.lostAt).toBeNull();
        continue;
      }
      expect(["lost", "open"]).toContain(r.status);
      if (r.status === "lost") {
        lost++;
        const last = r.entered.filter((e) => e !== null).at(-1) as string;
        expect(r.lostAt).not.toBeNull();
        expect(utc(r.lostAt!)).toBeGreaterThanOrEqual(utc(last));
        expect(utc(r.lostAt!)).toBeLessThanOrEqual(asOf);
      } else {
        expect(r.lostAt).toBeNull();
      }
    }
    // Most deals that went nowhere are marked lost, and some are still open.
    expect(lost).toBeGreaterThan(rows.filter((r) => r.status === "open").length);
    expect(rows.filter((r) => r.status === "open").length).toBeGreaterThan(0);
  });

  it("plants a known change: deals that entered after the new qualification process move on more often", () => {
    const utc = (t: string) => Date.parse(t.replace(" ", "T") + "Z");
    const change = Date.parse(PIPELINE_CHANGE_AT);
    const share = (later: boolean) => {
      const group = rows.filter((r) => (utc(r.entered[0]!) >= change) === later && utc(r.entered[0]!) < Date.parse(PIPELINE_AS_OF) - 90 * DAY);
      return group.filter((r) => r.entered[1] !== null).length / group.length;
    };
    expect(share(true)).toBeGreaterThan(share(false) + 0.04);
  });

  it("uses only labels, never an email or a name", () => {
    for (const r of rows.slice(0, 300)) expect(JSON.stringify(r)).not.toMatch(/@/);
  });
});
