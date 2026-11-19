import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PIPELINE_AS_OF, PIPELINE_STAGES, syntheticPipeline, type PipelineRow } from "../demo/pipeline";
import { createNodeEngine } from "../intake/testing/node-engine";
import type { SqlEngine } from "../intake/types";
import { MIN_GROUP } from "./compare";
import { loadPipeline, pipelineCounts } from "./pipeline";
import { firstEntry, pipelineAt, pipelineSeries, scrubberDates, stageRecords } from "./pipeline-drill";

const DAY = 86_400_000;
const text = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const T0 = Date.parse("2026-01-01T00:00:00Z");
const at = (day: number) => text(T0 + day * DAY);

function deal(
  segment: PipelineRow["segment"],
  days: (number | null)[],
  status: PipelineRow["status"],
  lostDay: number | null = null,
): PipelineRow {
  const entered = days.map((d) => (d === null ? null : at(d)));
  const reached = entered.filter((e) => e !== null).length;
  return { segment, source: "inbound", entered, stage: PIPELINE_STAGES[reached - 1], lostAt: lostDay === null ? null : at(lostDay), status };
}

describe("stageRecords on deals worked out by hand", () => {
  // 30 won deals: Lead day 0, Qualified day 4, Proposal day 14, Won day 31.
  // 30 lost deals: Lead day 1, Qualified day 9, lost on day 40 while in Qualified.
  // 30 open deals still in Lead since day 2.
  // 5 open deals in Proposal since day 20, too few to show.
  const rows = [
    ...Array.from({ length: 30 }, () => deal("smb", [0, 4, 14, 31], "won")),
    ...Array.from({ length: 30 }, () => deal("mid", [1, 9, null, null], "lost", 40)),
    ...Array.from({ length: 30 }, () => deal("enterprise", [2, null, null, null], "open")),
    ...Array.from({ length: 5 }, () => deal("smb", [0, 5, 20, null], "open")),
  ];
  const asOf = new Date(T0 + 100 * DAY).toISOString();
  let e: SqlEngine;
  beforeAll(async () => {
    e = await createNodeEngine({ isolated: true });
    await loadPipeline(e, "pipeline", rows);
  });
  afterAll(async () => {
    await e.close?.();
  });

  it("lists the deals that reached a stage, in a fixed order, with days in the stage and what happened next", async () => {
    const r = await stageRecords(e, "pipeline", {}, { stageIndex: 1, which: "reached", offset: 0, limit: 100, asOf });
    expect(r.stage).toBe("Qualified");
    expect(r.groupSize).toBe(65);
    expect(r.hidden).toBe(false);
    expect(r.records).toHaveLength(65);
    const won = r.records[0];
    expect(won).toMatchObject({ label: "Synthetic deal 0", segment: "smb", status: "won", enteredAt: "2026-01-05", days: 10, outcome: "Moved to Proposal" });
    const lost = r.records[30];
    expect(lost).toMatchObject({ label: "Synthetic deal 30", status: "lost", enteredAt: "2026-01-10", days: 31, outcome: "Lost" });
    const open = r.records[64];
    expect(open).toMatchObject({ label: "Synthetic deal 94", status: "open", days: 15, outcome: "Moved to Proposal" });
  });

  it("counts days to the cutoff for a deal still open in the stage", async () => {
    const r = await stageRecords(e, "pipeline", {}, { stageIndex: 0, which: "open", offset: 0, limit: 5, asOf });
    expect(r.groupSize).toBe(30);
    expect(r.records[0]).toMatchObject({ label: "Synthetic deal 60", status: "open", days: 98, outcome: "Still open here" });
  });

  it("pages through the records and says where it is", async () => {
    const page1 = await stageRecords(e, "pipeline", {}, { stageIndex: 0, which: "reached", offset: 0, limit: 20, asOf });
    const page2 = await stageRecords(e, "pipeline", {}, { stageIndex: 0, which: "reached", offset: 20, limit: 20, asOf });
    expect(page1.of).toBe(95);
    expect(page1.records.map((x) => x.label)[0]).toBe("Synthetic deal 0");
    expect(page2.records.map((x) => x.label)[0]).toBe("Synthetic deal 20");
    expect(page2.offset).toBe(20);
  });

  it("has no days in stage after Won, because Won is the end", async () => {
    const r = await stageRecords(e, "pipeline", {}, { stageIndex: 3, which: "reached", offset: 0, limit: 5, asOf });
    expect(r.groupSize).toBe(30);
    expect(r.records[0]).toMatchObject({ status: "won", days: null, outcome: "Won" });
  });

  it("hides the records when fewer than the minimum match, and shows none of them", async () => {
    const r = await stageRecords(e, "pipeline", {}, { stageIndex: 2, which: "open", offset: 0, limit: 20, asOf });
    expect(r.groupSize).toBe(5);
    expect(r.minGroup).toBe(MIN_GROUP);
    expect(r.hidden).toBe(true);
    expect(r.records).toEqual([]);
  });

  it("honors the other filters", async () => {
    const r = await stageRecords(e, "pipeline", { segment: ["mid"] }, { stageIndex: 0, which: "reached", offset: 0, limit: 50, asOf });
    expect(r.groupSize).toBe(30);
    expect(r.records.every((x) => x.segment === "mid")).toBe(true);
  });

  it("refuses a bad stage, a bad page, a bad cutoff or a bad table name", async () => {
    const ok = { stageIndex: 0, which: "reached" as const, offset: 0, limit: 20, asOf };
    await expect(stageRecords(e, "pipeline", {}, { ...ok, stageIndex: 4 })).rejects.toThrow(RangeError);
    await expect(stageRecords(e, "pipeline", {}, { ...ok, offset: -1 })).rejects.toThrow(RangeError);
    await expect(stageRecords(e, "pipeline", {}, { ...ok, limit: 0 })).rejects.toThrow(RangeError);
    await expect(stageRecords(e, "pipeline", {}, { ...ok, limit: 101 })).rejects.toThrow(RangeError);
    await expect(stageRecords(e, "pipeline", {}, { ...ok, asOf: "soon" })).rejects.toThrow(RangeError);
    await expect(stageRecords(e, "pipeline", {}, { ...ok, which: "all" as never })).rejects.toThrow(RangeError);
    await expect(stageRecords(e, "pipeline; DROP TABLE x", {}, ok)).rejects.toThrow(RangeError);
  });
});

describe("pipelineAt, the pipeline as it stood on a date, worked out by hand", () => {
  const rows = [
    deal("smb", [0, 4, 14, 31], "won"),
    deal("mid", [1, 9, null, null], "lost", 40),
    deal("enterprise", [2, null, null, null], "open"),
  ];
  let e: SqlEngine;
  beforeAll(async () => {
    e = await createNodeEngine({ isolated: true });
    await loadPipeline(e, "pipeline", rows);
  });
  afterAll(async () => {
    await e.close?.();
  });

  it("puts each deal where it was on each date", async () => {
    const day = (d: number) => new Date(T0 + d * DAY).toISOString();
    expect(await pipelineAt(e, "pipeline", {}, day(0.5))).toMatchObject({ entered: 1, open: [1, 0, 0], won: 0, lost: 0 });
    expect(await pipelineAt(e, "pipeline", {}, day(10))).toMatchObject({ entered: 3, open: [1, 2, 0], won: 0, lost: 0 });
    expect(await pipelineAt(e, "pipeline", {}, day(20))).toMatchObject({ entered: 3, open: [1, 1, 1], won: 0, lost: 0 });
    expect(await pipelineAt(e, "pipeline", {}, day(35))).toMatchObject({ entered: 3, open: [1, 1, 0], won: 1, lost: 0 });
    expect(await pipelineAt(e, "pipeline", {}, day(45))).toMatchObject({ entered: 3, open: [1, 0, 0], won: 1, lost: 1 });
  });

  it("counts a deal in its new stage from the moment it enters, so the boundary is not counted twice", async () => {
    const r = await pipelineAt(e, "pipeline", {}, new Date(T0 + 4 * DAY).toISOString());
    expect(r.open).toEqual([2, 1, 0]);
  });

  it("refuses a date that is not a time", async () => {
    await expect(pipelineAt(e, "pipeline", {}, "yesterday")).rejects.toThrow(RangeError);
  });
});

describe("scrubberDates", () => {
  it("steps by whole weeks from the first entry and always ends on the cutoff", () => {
    const d = scrubberDates("2026-01-01T00:00:00Z", "2026-01-20T12:00:00Z", 7);
    expect(d).toEqual(["2026-01-01T00:00:00.000Z", "2026-01-08T00:00:00.000Z", "2026-01-15T00:00:00.000Z", "2026-01-20T12:00:00.000Z"]);
  });

  it("refuses an empty or backwards range and a bad step", () => {
    expect(() => scrubberDates("2026-02-01T00:00:00Z", "2026-01-01T00:00:00Z", 7)).toThrow(RangeError);
    expect(() => scrubberDates("2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z", 0)).toThrow(RangeError);
  });
});

describe("against the synthetic pipeline", () => {
  const generated = syntheticPipeline(20_000, 21);
  let e: SqlEngine;
  beforeAll(async () => {
    e = await createNodeEngine({ isolated: true });
    await loadPipeline(e, "pipeline", generated);
  }, 120_000);
  afterAll(async () => {
    await e.close?.();
  });

  it("finds as many deals behind each stage as a plain count", async () => {
    for (let i = 0; i < PIPELINE_STAGES.length; i++) {
      const r = await stageRecords(e, "pipeline", {}, { stageIndex: i, which: "reached", offset: 0, limit: 10, asOf: PIPELINE_AS_OF });
      expect(r.groupSize, PIPELINE_STAGES[i]).toBe(generated.filter((d) => d.entered[i] !== null).length);
    }
  });

  it("gives the generator's days in stage for the first deals behind Proposal", async () => {
    const r = await stageRecords(e, "pipeline", {}, { stageIndex: 2, which: "reached", offset: 0, limit: 20, asOf: PIPELINE_AS_OF });
    const mine = generated.map((d, i) => ({ d, i })).filter((x) => x.d.entered[2] !== null).slice(0, 20);
    r.records.forEach((rec, k) => {
      const { d, i } = mine[k];
      expect(rec.label).toBe(`Synthetic deal ${i}`);
      const end = d.entered[3] ?? d.lostAt ?? PIPELINE_AS_OF.replace("T", " ").replace("Z", "");
      const days = (Date.parse(end.replace(" ", "T") + "Z") - Date.parse(d.entered[2]!.replace(" ", "T") + "Z")) / DAY;
      expect(rec.days!, rec.label).toBeCloseTo(days, 6);
    });
  });

  it("accounts for every deal exactly once on every date: open in a stage, won, or lost", async () => {
    const first = Math.min(...generated.map((d) => Date.parse(d.entered[0]!.replace(" ", "T") + "Z")));
    for (const date of scrubberDates(new Date(first).toISOString(), PIPELINE_AS_OF, 30)) {
      const r = await pipelineAt(e, "pipeline", {}, date);
      expect(r.open.reduce((a, b) => a + b, 0) + r.won + r.lost, date).toBe(r.entered);
    }
  });

  it("matches today's pipeline at the cutoff", async () => {
    const r = await pipelineAt(e, "pipeline", {}, PIPELINE_AS_OF);
    const status = await pipelineCounts(e, "pipeline", "status", {});
    const of = (v: string) => status.find((c) => c.value === v)?.count ?? 0;
    expect(r.won).toBe(of("won"));
    expect(r.lost).toBe(of("lost"));
    expect(r.entered).toBe(generated.length);
    PIPELINE_STAGES.slice(0, 3).forEach((s, i) => {
      expect(r.open[i], s).toBe(generated.filter((d) => d.status === "open" && d.stage === s).length);
    });
  });
});

describe("firstEntry", () => {
  it("is the earliest time any deal entered, as UTC", async () => {
    const generated = syntheticPipeline(2_000, 5);
    const e = await createNodeEngine({ isolated: true });
    await loadPipeline(e, "pipeline", generated);
    const first = Math.min(...generated.map((d) => Date.parse(d.entered[0]!.replace(" ", "T") + "Z")));
    expect(await firstEntry(e, "pipeline")).toBe(new Date(first).toISOString());
    await e.close?.();
  });
});

describe("pipelineSeries, every date in one query", () => {
  const generated = syntheticPipeline(5_000, 9);
  let e: SqlEngine;
  beforeAll(async () => {
    e = await createNodeEngine({ isolated: true });
    await loadPipeline(e, "pipeline", generated);
  }, 120_000);
  afterAll(async () => {
    await e.close?.();
  });

  it("gives exactly what pipelineAt gives on every date, in date order, with and without a filter", async () => {
    const first = await firstEntry(e, "pipeline");
    const dates = scrubberDates(first, PIPELINE_AS_OF, 14);
    for (const sel of [{}, { segment: ["enterprise"] }]) {
      const series = await pipelineSeries(e, "pipeline", sel, dates);
      expect(series.map((s) => s.at)).toEqual(dates);
      for (let k = 0; k < dates.length; k++) {
        expect(series[k], dates[k]).toEqual(await pipelineAt(e, "pipeline", sel, dates[k]));
      }
    }
  });

  it("gives zeros, not missing dates, when the filter matches no deal", async () => {
    const dates = scrubberDates("2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z", 7);
    const series = await pipelineSeries(e, "pipeline", { segment: ["nobody"] }, dates);
    expect(series).toHaveLength(dates.length);
    for (const s of series) expect(s).toMatchObject({ entered: 0, open: [0, 0, 0], won: 0, lost: 0 });
  });

  it("refuses no dates, too many dates, or a date that is not a time", async () => {
    await expect(pipelineSeries(e, "pipeline", {}, [])).rejects.toThrow(RangeError);
    await expect(pipelineSeries(e, "pipeline", {}, Array.from({ length: 401 }, () => PIPELINE_AS_OF))).rejects.toThrow(RangeError);
    await expect(pipelineSeries(e, "pipeline", {}, ["soon"])).rejects.toThrow(RangeError);
  });
});
