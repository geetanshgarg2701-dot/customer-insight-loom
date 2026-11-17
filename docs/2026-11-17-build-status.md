# Build status

Written Tuesday November 17, 2026, for review finding R4-6. One table that says what is built, partial or not started, so the plan cannot promise what the code does not do. It was checked against the repository on this date. Update it whenever a row changes.

Words: BUILT means code and tests exist and run. PARTIAL means some of it exists, and the gap is stated. NOT STARTED means no code.

## Statistics

| Item | Status | Evidence and gap |
|---|---|---|
| Power check, exact formula, smallest detectable lift | BUILT | `src/lib/stats/power.ts` |
| Readout, Newcombe interval, pooled z p value, inconclusive wording | BUILT | `readout.ts`, `src/lib/app/verdict.ts` |
| Warning that significant results from small tests run high | BUILT | `verdict.ts` |
| Sample ratio check | BUILT | `srm.ts` |
| Benjamini Hochberg function | PARTIAL | `bh.ts` exists. No screen applies a correction. Holm is not built. |
| A/A, coverage and planted lift checks, shown on the methods page | BUILT | `honesty.ts`, `src/app/methods` |
| Fixed horizon, readout locked until the window closes | BUILT | `window.ts`, enforced in the app and in the database |
| Result versions with a reason | BUILT | `ledger_result_versions`, in the app and in the database |
| Incremental revenue | PARTIAL | A helper exists, no screen uses it, and it assumes equal order value in both arms. |
| CUPED | NOT STARTED | Moved to version 2 in the plan. |
| Deck export | NOT STARTED | `pptxgenjs` is not installed. |

## Ledger and assignment

| Item | Status | Evidence and gap |
|---|---|---|
| Ledger entries, registration, launch, confirmatory or exploratory label | BUILT | `src/lib/ledger/ledger.ts` |
| Ledger level false positive line | BUILT | `familywise.ts`, shown on the ledger screen |
| Audit trail | BUILT | `ledger_audit`, written by triggers in the database |
| Ledger export and import as a file | PARTIAL | A JSON file with a validator. A CSV export is not built. |
| Assignment by keyed hash, rebuild, results upload and check | BUILT | `src/lib/assignment` |
| Received column in the results upload, delivery shares and a rough scaled lift | BUILT | `src/lib/stats/delivery.ts`. Optional. The readout itself is never changed. The scaled lift is a rough division by the delivery gap, with no interval. |
| Synthetic demo data | BUILT | `src/lib/demo` |
| Evidence chain | NOT STARTED | |
| Click to explain on every number | NOT STARTED | |

## Data and privacy

| Item | Status | Evidence and gap |
|---|---|---|
| CSV intake in the browser, column mapping, blocked columns | BUILT | `src/lib/intake`, DuckDB-Wasm in a worker, self hosted |
| Redaction for email, phone, card, social security number, IPv4, street address | BUILT | `src/lib/redaction`, version 2, limits in `2026-11-12-redaction-known-limits.md` |
| Name redaction | NOT STARTED | Names are not covered. |
| Quote storage that refuses unredacted text | PARTIAL | In memory only, and no screen saves quotes. The database checks only that a stamp exists. |
| Compliance check with consent and suppression | NOT STARTED | Part C calls it must have. |
| Delete all control | NOT STARTED | |
| Usage meter with 80 percent warnings | NOT STARTED | |

## Database, accounts and hosting

| Item | Status | Evidence and gap |
|---|---|---|
| Supabase schema with row level security | BUILT | Seven migrations on the test project only, tests v4 to v6 and a privilege check. |
| Pilot accounts, a client for Supabase | NOT STARTED | The schema exists and the app never calls it. |
| Identity matching, plan section 5.5 | PARTIAL | `src/lib/identity`: exact match on the normalized email, merged and unmatched lists, possible plus tag pairs, masked display. A library with tests, no screen yet. |
| Time rules, plan sections 5.7 and 5.8 | PARTIAL | `src/lib/time`: elapsed time windows, days cut in the workspace zone, the March 8 and November 1 days, local times that do not exist or happen twice. A library with tests, no screen yet. |
| Webhook ingestion | NOT STARTED | A browser only app has no server to receive one. This needs a decision. |
| Keep alive | NOT STARTED | |
| Static copy for a host with no server | BUILT | Built and tested locally. Not deployed. See `2026-11-17-static-mirror.md`. |
| Deployed demo link | NOT STARTED | Not decided. |

## Product surface

| Item | Status | Evidence and gap |
|---|---|---|
| Journeys: three linked bar charts and a flow chart with drop off, on 100,000 synthetic customers | PARTIAL | `/journeys`, `src/lib/charts`. The chart coordinator is built and measured: 110 ms in the browser for a full update, against the plan's guess of 1 second. 4 of the 13 visuals, no replay, no what if, no top paths table. |
| Pipeline views: stage funnel, time in stage, stalled deals, cohort ladder, on 100,000 synthetic deals | PARTIAL | `/pipeline`, `src/lib/charts/pipeline.ts`. Deals are won, lost or open, and only open deals can be stalled. The cohort ladder compares months of entry inside a fixed window and flags months still maturing. Measured 164 ms in the browser for a full update. Not built: period comparison and the forecast fan. |
| AI features | NOT STARTED | Hosted AI is off until the free plan terms are confirmed. |
| Design system | BUILT | Quiet editorial, chosen by the owner on 2026-11-17, in `src/app/globals.css`: warm paper, serif type, system fonts, one light palette. Contrast at least 5.2 to 1. Every screen fits a phone at 375 pixels, tested. |
| Privacy and terms pages | NOT STARTED | |
| Landing page | BUILT | An early version: what it is, what works today, and a plain statement that it is untried on real data. |
| 404 page | PARTIAL | The Next.js default, now in the editorial style. |
| Favicon | PARTIAL | The default icon file. The page title is now "Evidence ledger". |
| Accessibility checks with axe, phone width tests | PARTIAL | A phone width test runs on every screen, 375 pixels with no sideways scroll. `axe-core` is not installed. |

## Tests today

On this date: 520 unit tests, 25 browser tests in Edge, 1 static mirror test, and the database tests that run on the test project. The type check, lint and build pass. Lint has one warning, an unused type parameter in `src/lib/redaction/testdata/planted.ts`.

## Work remaining, in hours

Written 2026-11-17. Every figure here is INFERRED from the plan's own phase budgets, and the item estimates are SPECULATION. No hours were tracked while building, so nothing below is measured. Use it to compare scope, not to promise a date.

**Method.** The plan budgets 336 build hours across its phases. Crediting each phase for what exists gives about 129 hours done, or about 38 percent. Estimating the not started items one by one gave about 222 hours left. On 2026-11-17 identity matching and the time rules were built, about 10 hours, so about 212 were left. The chart coordinator and the first journey view then took about 14 more, so about 198 were left. The design system, the real home page and the phone width pass then took about 10 more, so about 188 were left. The first three pipeline views then took about 20 more, so about 168 were left. The lost status and the cohort ladder then took about 10 more, so about 158 are left and about 193 are done, which is 193 of 351, or about 55 percent. Against about 51 percent by item count.

| Not started item | Hours |
|---|---|
| Design system | 0 |
| Webhook ingestion, and screens for identity and time rules | 12 |
| Journey views, the rest of M16 | 28 |
| Pipeline views, the rest of M17 | 12 |
| Evidence chain, M6 | 14 |
| AI features with evals, including the in browser model, M8, M13, M15 | 30 |
| Deck export, M9 | 10 |
| Compliance check, delete all, usage meter, keep alive | 14 |
| Pilot accounts, a Supabase client | 12 |
| Name redaction | 8 |
| Click to explain, privacy and terms, 404 and favicon | 8 |
| Accessibility checks with axe, keyboard pass | 7 |
| **Total** | **158** |

At 12 to 15 hours a week that is about 10 to 13 weeks, so late January to mid February if work starts now and nothing slips. The plan's own schedule reaches its checkpoint at the same point, which suggests the plan was sized close to the real work. The two big risks are the journey and pipeline views, which are 40 of the 158 hours and hold the success metric the testers are asked about.

**What would shorten it.** Cutting the AI features, the deck export and pilot accounts saves about 52 hours, leaving about 106, which is about 7 to 9 weeks. The ledger, statistics, intake, redaction, demo and static copy would stay, and they are the parts that already work.

## Dependencies

Only two runtime packages are used beyond the app shell. This is a record, because the project rule is to ask before adding one.

- `@duckdb/duckdb-wasm` 1.32.0, approved in the first week, self hosted.
- `echarts` 6.1.0, approved by the owner on 2026-11-17 for the journey charts. Apache-2.0, published 2026-05-19, with `zrender` and `tslib` as its own dependencies. Loaded only in the browser and only with the bar chart, flow chart, tooltip, grid, accessibility and canvas parts. `npm audit` lists 7 moderate findings, all in the lint toolchain through `minimatch`, none in ECharts, and they predate it.
