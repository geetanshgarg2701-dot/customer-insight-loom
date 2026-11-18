# Customer Insight Loom

Customer journeys, pipelines and email experiments, woven into one picture with the evidence kept and the uncertainty shown. It is free. The ledger records each experiment: you record the bet before you send, hold back a control group, and read the result once, after the conversion window closes. When a result is too small to tell, it says so plainly.

It runs entirely in your browser. Your files are read on your own computer, held in memory, and never uploaded. There is no account and no tracking. See `/privacy` in the app for the details, and `src/lib/app/privacy-claims.test.ts` for the test that keeps those claims true.

**This is an early version.** It has not been tried on real customer data, and it does not remove personal names from text. A current, honest list of what is built and what is not is in [docs/2026-11-17-build-status.md](docs/2026-11-17-build-status.md).

## What works today

- **Ledger.** Record a hypothesis, check that the audience is large enough, assign a holdout by a keyed hash, and read out the result. The design locks at registration, results stay locked until the conversion window closes, and later readouts are numbered versions.
- **Data intake.** Load a CSV in the browser with DuckDB, map its columns, and preview 20 rows. Columns that look like personal data are blocked.
- **Journeys and pipeline.** Linked charts, a flow with drop off, top paths, a what if, a stage funnel, time in stage, stalled deals, a cohort ladder and a period comparison. These run on synthetic data.
- **Journeys.** Linked charts, a flow with drop off, top paths, a what if, and an anchored view that shows what customers did before and after any one event.
- **Data check.** Match two files on email and check a time column against clock changes, in the browser. Addresses are shown masked, and times that never happened or happened twice are listed by row, not guessed.
- **Methods.** The checks that ran on generated data to test the statistics, with the counts.
- **Explanations.** The main numbers can say how they were worked out, built from the real values.

## Run it

Needs Node.js. It was developed on Node 26.

```bash
npm install        # also copies the DuckDB files into public/duckdb
npm run dev        # http://localhost:3000
```

## Check it

```bash
npm test           # unit tests
npm run lint
npm run typecheck   # type check; first asks Next.js to generate the types it adds
npm run test:e2e   # browser tests, which start the dev server themselves
```

The browser tests use Playwright. To use a browser you already have installed instead of downloading one, set `PW_CHANNEL`, for example `PW_CHANNEL=msedge`.

## A static copy

The app needs no server, so it can be served as plain files.

```bash
npm run build:static                        # for a site of its own, or a custom domain
npm run build:static -- your-repo-name      # for a project page served under /your-repo-name
npm run test:static                         # tests a build made with the prefix evidence-ledger
```

The copy is written to `out/`. On Windows in Git Bash, write the prefix without a leading slash, because Git Bash rewrites a leading slash. The script prints the size of the copy and warns about hosts that cap the size of one file. See [docs/2026-11-17-release-checklist.md](docs/2026-11-17-release-checklist.md) before publishing it anywhere.

## Layout

| Folder | What is in it |
|---|---|
| `src/app` | The screens, in Next.js App Router |
| `src/lib/stats` | The statistics: power, readout, sample ratio check, correction, honesty checks |
| `src/lib/ledger`, `src/lib/assignment` | The ledger, the fixed horizon rule, assignment and results |
| `src/lib/redaction` | Rule based redaction and its known limits |
| `src/lib/charts`, `src/lib/demo` | Chart queries and the synthetic data they run on |
| `supabase` | Database migrations and tests for the pilot schema. They have been applied to a test project only. |
| `docs` | Decisions, measured results, known limits and the build status |

## Rules this project keeps

It costs nothing to run. Every number on screen comes from code, and the tests for statistics code are written first. Customer data stays in the browser. A new dependency is asked about before it is added, and the list so far is at the end of the build status document.

## License

No license has been chosen yet.
