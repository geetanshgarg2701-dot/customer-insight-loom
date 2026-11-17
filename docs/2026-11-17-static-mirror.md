# Static mirror: a copy of the site for a host with no server

Written Tuesday November 17, 2026, for review finding R4-5. Nothing is deployed. This only makes the app buildable as plain files and shows that the result works.

## Why

The app keeps every customer file in the browser, so it needs no server. A static copy can sit on GitHub Pages as a fallback to Vercel. The review found two risks with Vercel Hobby: a free transfer limit of 100 GB, where the first visit downloads about 35 MB of DuckDB files, and terms that limit Hobby to personal and non-commercial use. A second host removes the single point of failure for a demo link.

## How to build and test it

Build with the site prefix of a GitHub Pages project page, here `/evidence-ledger`. On Windows use PowerShell, because Git Bash rewrites a value that starts with a slash.

```powershell
$env:STATIC_EXPORT = "1"; $env:NEXT_PUBLIC_BASE_PATH = "/evidence-ledger"; npm run build
$env:PW_CHANNEL = "msedge"; npx playwright test -c playwright.static.config.ts
```

The output is the `out` folder. The test serves it under `/evidence-ledger/` with `scripts/serve-static-mirror.mjs`, loads the demo, clicks between pages, and fails if any request goes to another host or returns an error.

## What the static build changes

- `output: "export"` and `trailingSlash: true`, so each page is its own folder with an `index.html`.
- Cache Components and partial prefetching are turned off for this build only, because Next.js cannot export with them. The app does not use either. The normal build and its tests are unchanged.
- The DuckDB file paths take the site prefix, through `NEXT_PUBLIC_BASE_PATH`. Next.js adds the prefix to its own links but not to a path built by hand.

## Measured on 2026-11-17

- The static test passed: DuckDB loaded from its own prefix, the demo ran, and the Methods and Data intake links worked by clicking.
- The `out` folder is about 74 MB. The largest file is the 39 MB MVP wasm, under the 100 MB per file limit on GitHub Pages. The other limits were not checked here.

## Known limits

- Next.js asks the host for small prefetch files with names such as `__next.ledger.__PAGE__.txt`. A host that cannot rewrite paths, which includes GitHub Pages, answers 404 for them. Pages still load and links still work, as the test shows, but the browser console will show those 404s and a link may feel slightly slower.
- Not deployed. Deploying means turning on GitHub Pages for the repository and a workflow that builds with the two settings above. That is a decision for the repository owner.
- Whether GitHub Pages compresses wasm files is unverified, so the download size per first visit is unknown. Raw it is about 35 MB for the browser build.
- This does not address the hosted AI item in R4-5. That remains open.
