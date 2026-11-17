import { describe, expect, it } from "vitest";
import { csvCell } from "../app/csv";
import { LEDGER_CSV_COLUMNS, ledgerCsv } from "./csv";
import type { LedgerEntry } from "./ledger";

const base: LedgerEntry = {
  id: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  title: "Win back email",
  hypothesis: "A 10 percent offer brings lapsed customers back.",
  registeredAt: "2026-10-18T10:00:00.000Z",
  launchedAt: "2026-10-19T09:00:00.000Z",
  entryType: "confirmatory",
  themeId: null,
  segmentId: null,
  journeyId: null,
  frameworkTag: "PAS",
  design: { baselineRate: 0.08, audienceSize: 3598, secretLookingThing: "do not export" },
  powerResult: { pass: true },
  result: {
    lift: 0.0447,
    interval_low: 0.0212,
    interval_high: 0.0682,
    significant: true,
    p_value: 0.0003,
    treatment_rate: 0.1247,
    control_rate: 0.08,
    sample_sizes: { treatment: 1799, control: 1799 },
    engine_version: "stats-1",
  },
  comparisonsCount: 1,
  correctionMethod: "benjamini_hochberg",
  status: "readable",
  provenance: "local",
  synthetic: false,
};
const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({ ...base, ...over });

const parse = (csv: string) => csv.split("\r\n");

describe("csvCell, the shared spreadsheet protection", () => {
  it("quotes commas, quotes and line breaks, and doubles inner quotes", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("one\ntwo")).toBe('"one\ntwo"');
    expect(csvCell("plain")).toBe("plain");
  });

  it("puts a quote in front of anything a spreadsheet would run as a formula", () => {
    for (const risky of ["=1+1", "+1", "-1", "@SUM(A1)", "\tcmd", "\rcmd"]) {
      expect(csvCell(risky).replace(/^"/, "").startsWith("'"), risky).toBe(true);
    }
  });
});

describe("ledgerCsv", () => {
  it("writes the columns in a fixed order, then one row per entry, with Windows line endings", () => {
    const csv = ledgerCsv([entry(), entry({ id: "33333333-3333-4333-8333-333333333333", title: "Second" })], new Map());
    const lines = parse(csv);
    expect(lines[0]).toBe(LEDGER_CSV_COLUMNS.join(","));
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe("");
    expect(lines[1].startsWith("11111111-1111-4111-8111-111111111111,Win back email,")).toBe(true);
    expect(lines[2]).toContain("Second");
  });

  it("includes the first result and the numbers as the code worked them out", () => {
    const [header, row] = parse(ledgerCsv([entry()], new Map([[base.id, 3]])));
    const cols = header.split(",");
    const cells = row.split(",");
    const at = (name: string) => cells[cols.indexOf(name)];
    expect(at("status")).toBe("readable");
    expect(at("entry_type")).toBe("confirmatory");
    expect(at("framework_tag")).toBe("PAS");
    expect(at("lift")).toBe("0.0447");
    expect(at("interval_low")).toBe("0.0212");
    expect(at("interval_high")).toBe("0.0682");
    expect(at("significant")).toBe("true");
    expect(at("p_value")).toBe("0.0003");
    expect(at("n_treatment")).toBe("1799");
    expect(at("n_control")).toBe("1799");
    expect(at("result_versions")).toBe("3");
    expect(at("source")).toBe("this browser");
  });

  it("leaves the result columns empty for an entry with no result, and says not set for a missing type", () => {
    const [header, row] = parse(ledgerCsv([entry({ result: null, entryType: null, frameworkTag: null, status: "draft", registeredAt: null, launchedAt: null })], new Map()));
    const cols = header.split(",");
    const cells = row.split(",");
    const at = (name: string) => cells[cols.indexOf(name)];
    expect(at("lift")).toBe("");
    expect(at("significant")).toBe("");
    expect(at("entry_type")).toBe("not set");
    expect(at("framework_tag")).toBe("");
    expect(at("registered_at")).toBe("");
    expect(at("result_versions")).toBe("0");
  });

  it("protects a title or hypothesis that starts like a spreadsheet formula", () => {
    const csv = ledgerCsv([entry({ title: "=HYPERLINK(\"http://x.example\",\"click\")", hypothesis: "+cmd|' /C calc'!A0" })], new Map());
    const row = parse(csv)[1];
    expect(row).toContain("\"'=HYPERLINK(");
    expect(row).toContain("'+cmd|");
    expect(row).not.toMatch(/(^|,)=HYPERLINK/);
    expect(row).not.toMatch(/,\+cmd/);
  });

  it("quotes a hypothesis with commas and line breaks so it stays one cell", () => {
    const csv = ledgerCsv([entry({ hypothesis: "first, second\nthird" })], new Map());
    expect(csv).toContain('"first, second\nthird"');
  });

  it("labels where an entry came from, and quotes a label that contains a comma", () => {
    const row = (e: LedgerEntry) => parse(ledgerCsv([e], new Map()))[1];
    expect(row(entry({ synthetic: true }))).toContain(",synthetic demo,");
    expect(row(entry({ provenance: "imported" }))).toContain(',"imported, times not verified",');
    expect(row(entry())).toContain(",this browser,");
  });

  it("never carries the design, the workspace, or anything that could identify a person", () => {
    const csv = ledgerCsv([entry()], new Map());
    expect(csv).not.toContain("do not export");
    expect(csv).not.toContain(base.workspaceId);
    expect(csv).not.toMatch(/@|[0-9a-f]{64}/);
    expect(LEDGER_CSV_COLUMNS).not.toContain("design");
    expect(LEDGER_CSV_COLUMNS).not.toContain("workspace_id");
  });

  it("gives a header and nothing else for an empty ledger", () => {
    expect(ledgerCsv([], new Map())).toBe(LEDGER_CSV_COLUMNS.join(",") + "\r\n");
  });

  it("copes with a result that is not the usual shape", () => {
    const csv = ledgerCsv([entry({ result: { lift: "oops", sample_sizes: null } })], new Map());
    const [h, r] = parse(csv);
    const cells = r.split(",");
    expect(cells[h.split(",").indexOf("n_treatment")]).toBe("");
    expect(cells[h.split(",").indexOf("lift")]).toBe("");
  });
});
