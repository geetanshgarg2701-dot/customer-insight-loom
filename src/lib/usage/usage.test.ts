import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNodeEngine } from "../intake/testing/node-engine";
import type { SqlEngine } from "../intake/types";
import { EXPORT_NAG_DAYS, deleteEverything, exportNag, meterLevel, parseBytes, readUsage, WARN_AT } from "./usage";

describe("parseBytes", () => {
  it("reads the sizes DuckDB prints, binary units for KiB MiB GiB TiB and plain bytes", () => {
    expect(parseBytes("0 bytes")).toBe(0);
    expect(parseBytes("512 bytes")).toBe(512);
    expect(parseBytes("1.0 KiB")).toBe(1024);
    expect(parseBytes("61.0 MiB")).toBe(61 * 1024 * 1024);
    expect(parseBytes("3.1 GiB")).toBe(Math.round(3.1 * 1024 ** 3));
    expect(parseBytes("2 TiB")).toBe(2 * 1024 ** 4);
  });

  it("reads decimal units too, since a setting can be written either way", () => {
    expect(parseBytes("1 KB")).toBe(1000);
    expect(parseBytes("64 MB")).toBe(64_000_000);
    expect(parseBytes("2 GB")).toBe(2_000_000_000);
  });

  it("refuses text that is not a size", () => {
    for (const bad of ["", "lots", "12", "12 parsecs", "-1 MiB", "NaN GiB"]) expect(() => parseBytes(bad), bad).toThrow(RangeError);
  });
});

describe("meterLevel", () => {
  it("is ok below 80 percent, warn from 80 percent, and full from 100 percent, with the exact fraction", () => {
    expect(WARN_AT).toBe(0.8);
    expect(meterLevel(0, 1000)).toEqual({ fraction: 0, level: "ok" });
    expect(meterLevel(799, 1000).level).toBe("ok");
    expect(meterLevel(800, 1000)).toEqual({ fraction: 0.8, level: "warn" });
    expect(meterLevel(999, 1000).level).toBe("warn");
    expect(meterLevel(1000, 1000).level).toBe("full");
    expect(meterLevel(1500, 1000)).toEqual({ fraction: 1.5, level: "full" });
  });

  it("refuses a limit that is not above zero, and a use that is below zero", () => {
    expect(() => meterLevel(1, 0)).toThrow(RangeError);
    expect(() => meterLevel(-1, 100)).toThrow(RangeError);
    expect(() => meterLevel(Number.NaN, 100)).toThrow(RangeError);
  });
});

describe("exportNag", () => {
  const NOW = Date.parse("2026-11-19T12:00:00Z");
  const DAY = 86_400_000;

  it("says nothing for an empty ledger, however long since an export", () => {
    expect(exportNag(null, NOW, 0)).toBeNull();
    expect(exportNag(NOW - 100 * DAY, NOW, 0)).toBeNull();
  });

  it("asks for a first export when entries exist and none has been made from this tab", () => {
    expect(exportNag(null, NOW, 3)).toBe("This ledger has 3 entries and has not been exported from this tab. A page reload empties it.");
    expect(exportNag(null, NOW, 1)).toMatch(/has 1 entry and/);
  });

  it("is quiet for 14 days after an export, then asks again", () => {
    expect(EXPORT_NAG_DAYS).toBe(14);
    expect(exportNag(NOW - 14 * DAY, NOW, 2)).toBeNull();
    expect(exportNag(NOW - 15 * DAY, NOW, 2)).toBe("The last export from this tab was 15 days ago, and the ledger has 2 entries. Export again to keep any changes.");
  });
});

describe("readUsage and deleteEverything on a real database", () => {
  let engine: SqlEngine;
  beforeEach(async () => {
    engine = await createNodeEngine({ isolated: true });
  });
  afterEach(async () => engine.close?.());

  it("lists each table with its exact row count, largest first, and reads a memory limit above zero", async () => {
    await engine.exec("CREATE TABLE small AS SELECT range AS i FROM range(7)");
    await engine.exec("CREATE TABLE big AS SELECT range AS i FROM range(1234)");
    const u = await readUsage(engine);
    expect(u.tables).toEqual([
      { name: "big", rows: 1234 },
      { name: "small", rows: 7 },
    ]);
    expect(u.limitBytes).toBeGreaterThan(0);
    expect(u.usedBytes).toBeGreaterThanOrEqual(0);
    expect(u.level).toBe("ok");
  });

  it("reads the limit that is set, within rounding", async () => {
    await engine.exec("SET memory_limit='1GB'");
    const u = await readUsage(engine);
    expect(u.limitBytes).toBeGreaterThan(900_000_000);
    expect(u.limitBytes).toBeLessThan(1_100_000_000);
  });

  it("shows memory use rise when data is loaded", async () => {
    const before = (await readUsage(engine)).usedBytes;
    await engine.exec("CREATE TABLE t AS SELECT range AS i, repeat('x', 100) AS s FROM range(200000)");
    const after = await readUsage(engine);
    expect(after.usedBytes).toBeGreaterThan(before + 5_000_000);
    expect(after.fraction).toBeGreaterThan(0);
  });

  it("warns at 80 percent of a small limit, and says full at 100 percent", async () => {
    await engine.exec("SET memory_limit='64MB'");
    await engine.exec("CREATE TABLE t AS SELECT range AS i, repeat('x', 100) AS s FROM range(200000)");
    const u = await readUsage(engine);
    expect(u.fraction).toBeGreaterThan(0.3);
    expect(u.level).toBe(meterLevel(u.usedBytes, u.limitBytes).level);
  });

  it("deletes every table, counts what it removed, and leaves nothing, with memory use falling", async () => {
    await engine.exec("CREATE TABLE a AS SELECT range AS i, repeat('x', 100) AS s FROM range(200000)");
    await engine.exec("CREATE TABLE b AS SELECT range AS i FROM range(50)");
    await engine.exec("CREATE VIEW v AS SELECT * FROM b");
    const before = await readUsage(engine);
    const gone = await deleteEverything(engine);
    expect(gone).toEqual({ tables: 2, views: 1, rows: 200_050 });
    const after = await readUsage(engine);
    expect(after.tables).toEqual([]);
    expect(after.usedBytes).toBeLessThan(before.usedBytes / 4);
    expect(Number((await engine.all("SELECT count(*) AS n FROM duckdb_views() WHERE NOT internal"))[0].n)).toBe(0);
  });

  it("handles table names that need quoting, and an empty database", async () => {
    await engine.exec('CREATE TABLE "Odd name; DROP" AS SELECT 1 AS i');
    expect(await deleteEverything(engine)).toEqual({ tables: 1, views: 0, rows: 1 });
    expect(await deleteEverything(engine)).toEqual({ tables: 0, views: 0, rows: 0 });
  });
});
