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
| Received or delivered column in the results upload | NOT STARTED | The readout warns instead. |
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
| Webhook ingestion and identity | NOT STARTED | |
| Keep alive | NOT STARTED | |
| Static copy for a host with no server | BUILT | Built and tested locally. Not deployed. See `2026-11-17-static-mirror.md`. |
| Deployed demo link | NOT STARTED | Not decided. |

## Product surface

| Item | Status | Evidence and gap |
|---|---|---|
| Journey and pipeline modules with the 13 visuals | NOT STARTED | |
| AI features | NOT STARTED | Hosted AI is off until the free plan terms are confirmed. |
| Privacy and terms pages | NOT STARTED | |
| Landing page | PARTIAL | A home page exists. |
| 404 page | PARTIAL | The Next.js default. |
| Favicon | PARTIAL | The default icon file. |
| Accessibility checks with axe, phone width tests | NOT STARTED | Neither `axe-core` nor a phone viewport run is in the repository. |

## Tests today

On this date: 444 unit tests, 15 browser tests in Edge, 1 static mirror test, and the database tests that run on the test project. The type check, lint and build pass. Lint has one warning, an unused type parameter in `src/lib/redaction/testdata/planted.ts`.
