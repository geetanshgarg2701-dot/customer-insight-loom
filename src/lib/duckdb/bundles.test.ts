import { describe, expect, it } from "vitest";
import { selfHostedBundles } from "./bundles";

describe("selfHostedBundles", () => {
  it("points every file at the app's own origin under /duckdb by default", () => {
    const b = selfHostedBundles();
    expect(b.mvp).toEqual({
      mainModule: "/duckdb/duckdb-mvp.wasm",
      mainWorker: "/duckdb/duckdb-browser-mvp.worker.js",
    });
    expect(b.eh).toEqual({
      mainModule: "/duckdb/duckdb-eh.wasm",
      mainWorker: "/duckdb/duckdb-browser-eh.worker.js",
    });
  });

  it("accepts a custom base path and ignores a trailing slash", () => {
    const b = selfHostedBundles("/static/db/");
    expect(b.eh.mainModule).toBe("/static/db/duckdb-eh.wasm");
    expect(b.mvp.mainWorker).toBe("/static/db/duckdb-browser-mvp.worker.js");
  });

  it("never references a remote host", () => {
    const urls = Object.values(selfHostedBundles()).flatMap((x) => [
      x.mainModule,
      x.mainWorker,
    ]);
    for (const u of urls) expect(u).not.toMatch(/^[a-z]+:\/\//i);
  });
});
