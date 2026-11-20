import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The privacy page says the app stores nothing in the browser, sets no cookies, sends nothing anywhere, and has no
 * analytics. This test keeps that true: it fails if the app code starts using a storage, cookie or network API, or
 * names an outside address. Changing the privacy page and this test together is the point.
 */

const ROOT = join(__dirname, "..", "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx|css)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const FORBIDDEN: [string, RegExp][] = [
  ["localStorage", /\blocalStorage\b/],
  ["sessionStorage", /\bsessionStorage\b/],
  ["indexedDB", /\bindexedDB\b/],
  ["a cookie", /document\.cookie|cookies\(\)/],
  ["fetch", /\bfetch\s*\(/],
  ["XMLHttpRequest", /\bXMLHttpRequest\b/],
  ["a beacon", /sendBeacon/],
  ["a web socket", /\bWebSocket\b|\bEventSource\b/],
  // Reserved example domains, RFC 2606, are allowed: they can never be a real outside address. The email check uses one
  // in its synthetic example.
  ["an outside address", /https?:\/\/(?!www\.w3\.org\/|(?:[\w-]+\.)*example\.(?:com|org|net)[/:"'>\s]|[\w.-]+\.(?:invalid|test)[/:"'>\s])/],
  ["a service worker", /serviceWorker/],
];

describe("what the privacy page claims", () => {
  const sources = files(ROOT).map((path) => ({ path, text: readFileSync(path, "utf8") }));

  it("reads a believable number of source files, so an empty scan cannot pass", () => {
    expect(sources.length).toBeGreaterThan(40);
  });

  it("allows only reserved example domains through the outside address rule", () => {
    const rule = FORBIDDEN.find(([label]) => label === "an outside address")![1];
    expect(rule.test('"<https://shop.example.com/unsubscribe>"')).toBe(false);
    expect(rule.test('"https://www.ftc.gov/"')).toBe(true);
    expect(rule.test('"https://example.com.evil.net/"')).toBe(true);
    expect(rule.test('"https://notexample.com/"')).toBe(true);
  });

  it.each(FORBIDDEN)("no app code uses %s", (_label, pattern) => {
    const hits = sources.filter((s) => pattern.test(s.text)).map((s) => s.path.slice(ROOT.length));
    expect(hits).toEqual([]);
  });

  it("starts exactly one worker, the self hosted database", () => {
    const hits = sources.filter((s) => /new Worker\(/.test(s.text)).map((s) => s.path.slice(ROOT.length).replace(/\\/g, "/"));
    expect(hits).toEqual(["/lib/duckdb/client.ts"]);
  });

  it("adds no analytics or error reporting package", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "..", "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const names = Object.keys(pkg.dependencies);
    expect(names.filter((n) => /posthog|sentry|analytics|gtag|segment|amplitude|mixpanel|hotjar/i.test(n))).toEqual([]);
  });
});
