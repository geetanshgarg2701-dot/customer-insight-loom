import type { NextConfig } from "next";

// A static copy of the site, for a host with no server such as GitHub Pages. It is off by default, so the normal
// build and the tests are unchanged. Build it with STATIC_EXPORT=1, and set NEXT_PUBLIC_BASE_PATH to the project
// page prefix, for example /evidence-ledger. Nothing in the app needs a server, because every file stays in the browser.
const staticExport = process.env.STATIC_EXPORT === "1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() || undefined;

const nextConfig: NextConfig = {
  ...(staticExport ? { output: "export" as const, trailingSlash: true, images: { unoptimized: true } } : {}),
  ...(basePath ? { basePath } : {}),
  cacheComponents: !staticExport,
  partialPrefetching: !staticExport,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
