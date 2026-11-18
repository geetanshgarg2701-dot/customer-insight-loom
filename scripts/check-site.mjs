// Scans the built site in out/ for things that must not be published: real email addresses, absolute paths from a
// developer machine, key-like strings, and source maps. It holds no personal detail itself. Run it after build:static.
// Exit code 1 means something was found, and each finding is printed with its file.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const OUT = process.argv[2] ?? "out";
const TEXT = /\.(html|js|css|txt|json|map|svg|xml|webmanifest)$/i;

// Author credits inside bundled libraries, checked by hand. Add an address here only after reading where it appears.
const THIRD_PARTY_CREDITS = new Set(["emn178@gmail.com"]); // a hash library's copyright header inside DuckDB's worker files

const CHECKS = [
  { name: "an email address", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    // Reserved demo domains and the placeholders in documentation are not real addresses.
    allow: (m) => THIRD_PARTY_CREDITS.has(m) || /@(?:[\w.-]*\.)?(?:invalid|example\.(?:com|org|net)|test|localhost)$/i.test(m) },
  { name: "a Windows user path", re: /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+/g },
  { name: "a Unix home path", re: /\/(?:Users|home)\/[a-z0-9._-]+\//gi,
    // Library code mentions generic paths such as /home/user/ in comments.
    allow: (m) => /\/(?:user|username|name|you|me)\/$/i.test(m) },
  { name: "a key-like string", re: /\b(?:sb_secret_[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b/g },
];

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const full = join(dir, n);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

if (!existsSync(OUT)) {
  console.error(`No ${OUT}/ folder. Run npm run build:static first.`);
  process.exit(2);
}

const findings = [];
let scanned = 0;
for (const file of walk(OUT)) {
  const rel = relative(OUT, file).replace(/\\/g, "/");
  if (/\.map$/i.test(file)) findings.push(`${rel}: a source map, which would publish the source code`);
  if (!TEXT.test(file)) continue;
  scanned++;
  const text = readFileSync(file, "utf8");
  for (const { name, re, allow } of CHECKS) {
    for (const m of text.matchAll(re)) {
      if (allow?.(m[0])) continue;
      findings.push(`${rel}: ${name}`);
      break;
    }
  }
}

if (findings.length > 0) {
  console.error(`Found ${findings.length} thing(s) to look at before publishing:`);
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`Scanned ${scanned} text files in ${OUT}/: no email address, developer path, key or source map found.`);
