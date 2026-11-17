/**
 * The path a static copy of the site is served under, such as /evidence-ledger on a GitHub Pages project page, or no
 * prefix at all on a site of its own. One function, used by the build configuration, so a prefix written as
 * "evidence-ledger", "/evidence-ledger" or "/evidence-ledger/" all mean the same thing.
 */

/** One path segment: letters, digits, underscore, tilde, hyphen and inner dots. Never empty, never starting with a dot. */
const SEGMENT = /^[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/;

export function normalizeBasePath(raw: string | undefined): string | undefined {
  const value = (raw ?? "").trim();
  if (value === "" || value === "/") return undefined;

  // Git Bash on Windows rewrites a leading slash into the install folder before the program sees it.
  if (/^[A-Za-z]:[\\/]/.test(value)) {
    throw new RangeError(
      `The prefix "${value}" looks like a Windows path. Git Bash turns a leading slash into one. ` +
        `Write the prefix without the leading slash, for example evidence-ledger, or run the build from PowerShell.`,
    );
  }
  if (value.startsWith("//") || value.includes("://")) {
    throw new RangeError("The prefix must be a path such as evidence-ledger, not a web address.");
  }

  const segments = value.replace(/^\/+|\/+$/g, "").split("/");
  if (segments.some((s) => !SEGMENT.test(s) || s === ".." || s === ".")) {
    throw new RangeError(
      "The prefix must be a plain path such as evidence-ledger, with no spaces, empty or dotted segments, query or fragment.",
    );
  }
  return `/${segments.join("/")}`;
}
