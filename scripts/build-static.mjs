// Builds a static copy of the site into out/, for a host with no server. Usage:
//   npm run build:static                       the site root, for a site of its own or a custom domain
//   npm run build:static -- evidence-ledger    a project page served under /evidence-ledger
// The prefix can also come from NEXT_PUBLIC_BASE_PATH. It is checked by next.config.ts, which rejects a bad one.
// On Windows in Git Bash, write the prefix without the leading slash, or run this from PowerShell.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const prefix = process.argv[2] ?? process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");

const build = spawnSync(process.execPath, [nextBin, "build"], {
  stdio: "inherit",
  env: { ...process.env, STATIC_EXPORT: "1", NEXT_PUBLIC_BASE_PATH: prefix },
});
if (build.status !== 0) process.exit(build.status ?? 1);

// GitHub Pages, when it builds a site itself, skips folders that start with an underscore, which would drop _next.
// This file tells it not to. It does no harm on any other host.
writeFileSync(join("out", ".nojekyll"), "");

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [{ path: relative("out", full).replace(/\\/g, "/"), size: statSync(full).size }];
  });
}

const all = files("out");
const total = all.reduce((n, f) => n + f.size, 0);
const biggest = [...all].sort((a, b) => b.size - a.size).slice(0, 3);
const mib = (n) => (n / 1024 / 1024).toFixed(1);
console.log(`\nStatic copy in out/: ${all.length} files, ${mib(total)} MiB, prefix "${prefix || "(site root)"}".`);
for (const f of biggest) console.log(`  largest: ${f.path}  ${mib(f.size)} MiB`);

// Hosts have file size limits. These are the ones that matter, read from their documentation on 2026-11-17.
const over25 = all.filter((f) => f.size > 25 * 1024 * 1024);
if (over25.length > 0) {
  console.log(
    `\nNote: ${over25.length} file(s) are over 25 MiB, the Cloudflare Pages Free limit for one file: ` +
      `${over25.map((f) => f.path).join(", ")}. GitHub Pages allows a site up to 1 GB.`,
  );
}
