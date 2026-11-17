// Serves the static export in out/ under a site prefix, the way a GitHub Pages project page does.
// Used only to test the static build locally. Usage: node scripts/serve-static-mirror.mjs [prefix] [port]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const prefix = "/" + (process.argv[2] ?? process.env.NEXT_PUBLIC_BASE_PATH ?? "/evidence-ledger").replace(/^\/+|\/+$/g, "");
const port = Number(process.argv[3] ?? 3100);
const root = fileURLToPath(new URL("../out/", import.meta.url));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function find(path) {
  for (const candidate of [path, join(path, "index.html"), path + ".html"]) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // try the next one
    }
  }
  return null;
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const outside = url.pathname !== prefix && !url.pathname.startsWith(prefix + "/");
  const relative = outside ? null : decodeURIComponent(url.pathname.slice(prefix.length));
  const rootBase = root.endsWith(sep) || root.endsWith("/") ? root.slice(0, -1) : root;
  const target = relative === null ? null : normalize(join(rootBase, relative));
  // Anything that resolves outside out/ is refused, so a path such as ../ cannot read other files.
  const inside = target !== null && (target === rootBase || target.startsWith(rootBase + sep));
  const file = inside ? await find(target) : null;
  if (!file) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(await readFile(file));
}).listen(port, () => console.log(`Static mirror at http://localhost:${port}${prefix}/`));
