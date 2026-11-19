# Knowledge file: Customer Insight Loom

Written Wednesday November 18, 2026, to paste into a Claude chat so it can review the project. It describes what was built, what was checked, what was found wrong and fixed, and what is still open. Every figure comes from the code or from a test run in this project. Where something is a guess, it says so. It holds no personal details.

## How to use this file

Paste the whole file into a new Claude chat, then ask for a review. Good questions are listed at the end. The chat cannot see the code, so tell it to treat this file as the record and to say what it cannot check from it.

## 1. What the app is

Customer Insight Loom is a free tool for marketing teams, running entirely in the browser. It was called Evidence ledger until November 18, 2026. It does three jobs:

- **Experiments.** A ledger for email experiments. A person records the bet before sending, assigns a holdout group by a keyed hash, and reads the result with its uncertainty. A result stays locked until the conversion window closes. It says plainly when a test is too small to tell.
- **Journeys.** Linked charts of where customers drop off, on synthetic data, a view of what customers did before and after any one event, a side by side comparison of two segments or two channels, the time people take between steps, who is behind any step shown as groups only, a replay of one synthetic customer's path, and a designed journey canvas with live numbers on every step.
- **Pipeline.** Where deals wait, how long they sit in each stage, which have stalled, how a period compares with another, and an outlook for open deals.

Two helper screens: a data check that matches two files on email and checks a time column against clock changes, and a methods page showing the checks that were run on generated data.

**Honest state.** It is ready to show as an early, free version on synthetic data. It has never been tried on real customer data. A lawyer has not read the privacy and terms pages. No one has done a screen reader pass. It is a portfolio project.

## 2. Rules it was built under

- Cost stays zero. Ask before adding any dependency.
- Every number comes from code, never from a model, and every statistic shows its method.
- No secrets in code.
- Statistics code is written test first.
- US English, and no em dashes in text the app shows.
- All user data stays in the browser. DuckDB-Wasm runs in a Web Worker with self-hosted wasm files.
- TypeScript strict.
- Say association, not cause, unless a holdout supports it.
- Supabase tables need a workspace identifier and row level security before any data is stored.
- Commit small. Run gitleaks and Semgrep before each push.

## 3. Stack

Next.js 16.4.6 with the App Router, React 19.3, Tailwind 4.3.3, TypeScript strict, Vitest 5, Playwright run in Edge, DuckDB-Wasm 1.32.0, ECharts 6.1.0 drawn on canvas and tree shaken, and axe-core for accessibility checks as a development dependency. Supabase exists as a schema on a test project only. The designed journey canvas uses React Flow 13.0.2, MIT, which was added on 2026-11-18. The app does not call it.

## 4. Size, as of the last commit

- 81 commits from 2026-11-11 to 2026-11-18 as of commit `9726a8d`. A file that names its own latest commit is always one behind. The file and line counts below are from `7b0629f`.
- 193 tracked files and about 22,200 lines, with the lock file excluded. Source is 78 files and 10,134 lines. Tests are 77 files and 9,575 lines. Docs are 17 files and 1,210 lines. Supabase is 8 files and 852 lines.
- Screens: home, ledger, an entry page, intake, journeys, pipeline, data check, methods, privacy, terms and a 404 page.

## 5. What was verified

| Check | Result |
|---|---|
| Unit tests, Vitest | 895 passed in 68 files |
| Browser tests, Playwright in Edge | 85 passed in 22 files |
| Static mirror test | 1 passed. It proves the site works under a project prefix with no request to another host |
| Database tests, SQL on a Supabase test project | 6 files plus a seventh for the correction label. Not rerun on every change |
| Type check and lint | Clean. Lint has one old warning |
| Semgrep, rules p/typescript, p/javascript and p/secrets | 0 findings on 152 files |
| Gitleaks | No leaks in the history |
| Accessibility, axe against WCAG 2.0 and 2.1 A and AA | 0 confirmed violations on every screen and state tested. This does not prove a screen is accessible |

**Statistics, checked by simulation and by random inputs.**

| Claim | Measured |
|---|---|
| The interval for a difference covers the truth about 95 percent of the time | 95.5 and 96.2 percent over 4,000 runs each. It is known to run slightly conservative |
| The power check delivers the promised 80 percent | 1,774 per arm detected a 3 point lift 81.8 percent of the time over 1,500 runs |
| With no real difference, a difference is called about 5 percent of the time | 4.6 to 5.1 percent over 30,000 runs for each of six settings |
| Benjamini Hochberg controls false discoveries | 5.3 percent under the null over 2,000 runs of 50 tests. With real and null effects mixed, 4,000 runs of 40 tests each, the rate was 0.0467, 0.0360 and 0.0248 against targets of 0.0450, 0.0375 and 0.0250, and it found more real effects than Bonferroni. Tested only, not used on any screen |
| The sample ratio check is about uniform for a fair split | Fell below 0.05 in 5.3 percent of 2,000 runs |

Method: a Newcombe hybrid score interval for the difference, Wilson for single rates, a pooled z test for the p value, and an exact two-proportion power formula. A result is called significant exactly when the interval excludes zero. A fixed horizon rule applies, with no peeking. The two calls disagree rarely, and mostly when conversions are few, not only when samples are small. A simulation on 2026-11-18 found 135 of 10,000 disagreements at 500 per arm and a 2 percent rate, with the effect at the detection edge, and almost every disagreement was the p value calling a result significant that the interval did not. See `2026-11-18-interval-and-p-value-agreement.md`.

## 6. What works end to end, from the code

A feature counts here only if a screen calls it.

- **Experiment ledger.** Draft, register with a lock, assign by keyed hash, launch, label confirmatory or exploratory by the order of registration and launch, a readout locked until the window closes, numbered result versions that need a reason, a sample ratio check, a plain-words verdict, JSON export and import, CSV export with protection against spreadsheet formulas, and filters.
- **Power check.** Sample size and the smallest detectable lift.
- **Demo.** Three synthetic entries whose outcomes are fixed by design, labeled synthetic.
- **Data intake.** Load a CSV with DuckDB, map columns, and preview 20 rows. Columns that look like personal data are blocked by name and by value.
- **Insights, part one.** Insights module, first part (SOURCED, tested): a seeded generator makes synthetic customer comments, each tied to a real synthetic journey customer, with planted pains (shipping cost for Cart leavers and new customers, pricing for ads, slow support for Support users, slow delivery for buyers) and planted fake personal details on reserved domains and numbers. A redaction scorecard compares planted with caught. Emails, phones, cards and addresses show 0 missed. Names are planted and all missed, by design, because the rules do not cover names, and the scorecard says so. Only consented comments are kept, and only as redacted quotes. An edit is redacted again. The DuckDB comments table stores only redacted quotes and refuses the whole load if one quote was not issued by the redaction step. Mention rates per pain, with 95 percent Wilson intervals, come from joining comments to journeys on the customer, grouped by step reached, segment, channel or use of Support. Groups under 30 comments are hidden, and comments that match no customer are counted apart. Tested on hand counts and against an independent count of the generator, and the planted Cart and Support facts come out with intervals that do not overlap. Three mutations each failed tests. The Comments screen, at /insights and in the main links, loads 3,000 synthetic comments from 20,000 synthetic customers. It shows the redaction scorecard with names marked not covered, a table of mention shares with ranges by step reached, segment, channel or contact with Support, and the redacted quotes for one pain, ten at a time. A Correct button opens the text, and saving redacts it again before it is stored, so an edit cannot put a detail back in. The coded pain does not change. Three browser tests check the numbers against the generator, the correction step, axe and phone width. Not yet built: the evidence chain and the journeys why panel. Semgrep did not run for the generator commit 11ea008 because the venv first tried was broken. The working copy, sgvenv, later scanned all insights files with 0 findings.
- **Shareable views.** The journeys and pipeline screens each give a link that holds only filter and section choices, never data or a name. A link is checked against fixed lists when opened, and anything else in it is ignored and named on screen.
- **Journeys.** 100,000 synthetic customers. Linked bar charts, a flow with drop off, top paths with rare routes merged into one labeled group, a what if that says what it assumes, an anchored view with up to three steps before and after one event, and a side by side comparison of two groups with each step rate and gap shown with its interval, the number of comparisons, a small group warning, and every result labeled exploratory. Time between steps shows the median and spread of hours to the next step, with people still inside their window shown apart from those who dropped. The synthetic journeys have UTC timestamps from documented assumptions, with one planted timing fact: new customers take twice as long to buy. Behind a step shows who reached a step by segment and channel, with groups under 30 people merged and hidden if still too small, and selecting a step in the flow chart opens it. Replay one path steps through a single synthetic customer with times in UTC, and the code returns no path at all when fewer than 30 people match. The filter update reads 164 to 251 ms in the browser, a noisy figure whose rise from 135 ms is unexplained. The eight view queries total about 130 ms in Node, a guard test watches them, and two small speedups were measured to help only a little.
- **Pipeline.** Records behind any stage, a page at a time with made up deal numbers and a 30 deal minimum, and a week by week scrubber of the pipeline on any past date. Funnel, time in stage, stalled deals, a cohort ladder, a period comparison, and an outlook for open deals that learns win rates from closed deals and shows its uncertainty.
- **Data check.** Email matching on the normalized address with masked lists, and a time column check that lists, by row, times that never happened or happened twice around clock changes.
- **Methods page, privacy and terms pages, a 404 page, an icon.** A test fails if the app starts using storage, cookies, network calls or analytics.
- **Static export tooling.** One command builds the site under a prefix, a scan checks the output for email addresses, developer paths, keys and source maps, and a browser test checks the prefix.

## 7. Partly built or not built

**Partly built, from the code:**
- **Multiple comparison correction.** Holm, which the plan prefers for fewer than 10 comparisons, is built and applied across the step differences in the side by side comparison of two groups. Benjamini Hochberg exists with tests and no screen uses it. A ledger readout makes one comparison, so it needs no correction.
- **Incremental revenue.** A helper exists, and no screen uses it.
- **Text redaction.** The function runs only on a planted test set shown on the methods page. It is not applied to any data a person loads. Intake only blocks columns.
- **Time rules.** Only the local time reader is used, by the data check, which reports flagged rows and does not exclude them. The window and day functions in the time library are used only by tests.
- **Supabase.** The schema has 8 migrations and row level security, on the test project only. The app has no client and no dependency on it.

**Not built, with no code:** wait steps and exit conditions on the canvas, saving a design, a time scrubber for journeys, saved views that persist, the evidence chain, deck export, webhook ingestion, hosted AI features, and accounts or sign in.

## 8. Problems found and fixed, in the order they came up

1. **A slow date formatter.** Property tests found that cutting 100,000 events into days took 6.3 seconds and reading 20,000 local times took 4.7 seconds, because a new formatter was built for every call. Each time zone's formatter is now built once. The times are 0.4 and 0.2 seconds. Two speed guard tests now fail if it returns.
2. **A false scare.** A first false positive run read 5.9 percent over 3,000 runs. It was sampling noise. The 30,000 run result was 4.6 to 5.1 percent.
3. **An idea rejected on evidence.** Warning when observed power is low on a significant result cannot work, because observed power is a rescaling of the p value. It was replaced by a rule comparing the interval with the lift.
4. **A random demo.** Each demo load was a fresh random draw. The zero lift entry would read significant about 1 time in 20, and the 4 point entry would read not significant about 1 time in 5, which would have broken a tester session. Conversions per group now match the planted rate exactly, tested under eight different secrets, and the screen says the outcomes are set. This is a design tradeoff: the demo shows a typical outcome, not a random one.
5. **A label that claimed a correction that never ran.** Confirmatory results were stored as `benjamini_hochberg` with one comparison, while `bh.ts` was called nowhere. They are now labeled `not_applied`. The old label stays valid on import, and the screen says no correction ran for an old result. A function refuses more than one comparison unless a real correction is run. The database constraints were widened on the test project only.
6. **Tests that timed out under load.** With 49 test files running at once, tests that take 0.5 to 2 seconds passed the 5 second default. The limit is now 30 seconds. The code was not slower.
7. **A stale build error.** One static build failed with an internal Next.js error from a leftover cache. The static build now starts from a clean slate.
8. **A scan that looked clean and was not.** A gitleaks run on uncommitted changes stopped with an error and scanned nothing. It was not counted as a pass, and the files were scanned directly instead.

## 9. Decisions already made

- The name is Customer Insight Loom. A loom weaves many threads into one cloth, as the app weaves customer paths into one picture. A well-known video tool is also called Loom, so a tagline keeps it distinct.
- Hosting is GitHub Pages from a separate public repository holding only the built site, MIT licensed. The source repository stays private, because its history holds personal details. The public repository is named `customer-insight-loom`, because the source repository already holds the name `evidence-ledger`.
- Identity matching in version 1 is exact on the normalized address. Dots and plus tags are never merged. Plus tag pairs are shown for a person to judge.
- Quiet editorial design, one light palette, system fonts.
- Name redaction packages were not approved, so that feature is deferred.
- Real customer data is allowed only in one planned experiment on a tester's own data, run in the tester's browser, with written consent. Otherwise testers use the demo.

## 10. Where it stands

- The private source repository is up to date on `main` at `7b0629f`.
- The public site was pushed once, before the label fix and after the rename. Turning on GitHub Pages was left to the owner, and it is not confirmed that the site is live. The label fix is not in the public site yet. A static copy rebuilt on 2026-11-18 with the current label passes the site scan, with 93 text files and no email address, developer path, key or source map found. It is built into the ignored `out` folder and has not been pushed anywhere.
- A pilot kit exists: a 30 minute session script with a fixed scoring rule, and a real-data plan. The scoring rule for the task "find where most people leave" is set in advance. The most customers are lost between Product and Cart, 33,792 of 100,000. The highest rate of loss is between Cart and Purchase, 54.1 percent. The metric counts customers, and the other reading is recorded separately. The thresholds, 3 of 5 testers within 3 minutes, are judgment and not a benchmark.
- Estimated work left is roughly 110 to 120 hours of the planned 351. This is an inference from the plan's phase budgets and a guess for each item, and no hours were tracked.

## 11. Open items that need a person

- A lawyer or advisor reading the privacy and terms pages.
- A screen reader pass, about an hour with NVDA. A checklist exists.
- Confirming the live site: that the wasm files load on GitHub Pages and that only same-site requests appear.
- Running real sessions with 3 to 5 testers.
- Hosted AI features and their free plan limits.
- The multiple comparison family correction, the evidence chain, deck export, replay and accounts.

## 12. Documents that are slightly out of date

- Two items listed here earlier were corrected on 2026-11-18: the test counts and migration count in the build status table, and the sentence in the plan corrections document that called the source repository public.
- Plan part B is tracked in the private repository. Only plan parts A, C and D are kept off it.

## 13. Questions worth asking Claude chat

1. Are the statistical claims in section 5 backed by what was measured? Is a 95.5 percent coverage on a nominal 95 percent interval acceptable, and are the simulation sizes enough?
2. Is fixing the demo outcomes a fair design, or does it hide how noisy real tests are?
3. Is `not_applied` the right label for one comparison, or should a one-comparison readout carry no correction field at all?
4. Where could the conversion window logic fail around clock changes, repeated events and customers still open at the cutoff?
5. Does any wording on a screen claim more than the evidence supports? Look especially at the verdict text and the "ended" bar in the journey view.
6. Is the scoring rule for the tester task fair, given two defensible answers?
7. What is the riskiest thing missing before showing this to people outside, and what would you cut?
