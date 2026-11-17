# Plan corrections and decisions

Written Tuesday November 17, 2026, from the review of November 16. It covers findings R1-2, R1-3, R4-1, R4-2, R4-3 and R4-4.

Parts A, C and D of the plan are kept on one machine and are not committed to this repository. They hold personal details, and this repository is public. That settles R4-2. So this file does not quote them. It says what each correction is, what the built code already does, and what still needs a decision.

Labels: BUILT means the code or schema already settles it. DECIDE means a person must choose. EDIT means only the plan text is wrong.

## R1-2 Planted lift promise, Part B section 6.3

- **Problem.** The plan says designs that passed the power check must detect the planted lift at least as often as the stated power. With power 0.80 over 500 runs, a correct engine detects 400 or more only about 53 percent of the time, so the literal rule fails a correct engine about 47 percent of the time.
- **Status.** BUILT. The honesty check uses a floor, not the literal rule.
- **EDIT.** Reword Part B to the floor rule: the count must be at least the lower end of the central 95 percent range of a binomial with 500 runs and p equal to the stated power, which is 382 for power 0.80. It is computed in code, like the A/A band. State that a correct engine misses this floor about 2 times in 100, not never.

## R1-3 A/A band, Part B section 6.3

- **Problem.** The plan says 36 to 64. The central 95 percent range for 1,000 runs at p 0.05 is 37 to 64, because the chance of 36 or fewer is 0.0212, which is below the 0.025 tail, so 36 is already outside. A correct engine falls outside the band in about 4 percent of runs.
- **Status.** BUILT. The code computes the band from the binomial, and gets 37 to 64. Only the plan text is off.
- **EDIT.** Change the band to 37 to 64, say it is computed, and say a correct engine lands outside it about 1 run in 24.
- **DECIDE.** Either require 2 of 3 seeds to be inside the band, or widen to a 99.9 percent band. The plan tells people to fix the engine when a run is outside, so without one of these someone will chase a false alarm. Recommendation: 2 of 3 seeds.

## R4-1 Sentry is still in the plan

- **Status.** Settled by `docs/2026-11-15-decision-error-tracking.md`: Sentry is out and PostHog error tracking is in.
- **EDIT.** In Part B the quotas row for PostHog and Sentry, and in Part C the Sentry tool row, the Sentry connector row, the "then Sentry and PostHog after launch" line, the Monitor row and the two retention lines, replace Sentry with PostHog error tracking. Remove the connector row. The free limits for error tracking stay UNVERIFIED until the PostHog pricing page is read.
- Nothing in `package.json`, `src`, `.env.example` or `CLAUDE.md` mentions Sentry.

## R4-3 Contradictions between parts

| Item | What the parts say | Status | Resolution |
|---|---|---|---|
| Framework tags | Part B 6.5, the schema and Part D say PAS, FAB and AIDA. Part C module M7 says FPB and RICE. | BUILT | The schema has a check on PAS, FAB and AIDA. Edit Part C M7 to match. |
| CUPED | Part B and Part C disagree on whether version 1 has it. | DECIDE | Recommendation: out of version 1. It is not built, and the readout is exact without it. |
| Assignment export | Part B says a hash only file. Part A says rejoin to addresses in the browser. | BUILT | The build follows Part A. Hashes leave the browser, addresses never do. Edit Part B. |
| Results | Part A says versions. Part B and the first schema had one result. | BUILT | `ledger_result_versions` exists in the app and, since migration 20261116150000, in the schema. Edit Part B. |
| Mosaic spike | One day in Part A and the Part C prompt title, half a day in Part C. | DECIDE | Recommendation: half a day, with a hard stop. |
| Pilot data | Part D invites testers to bring their own export. The tester doc says sample data only. | DECIDE | Recommendation: sample data only until redaction covers names, which it does not today. See `2026-11-12-redaction-known-limits.md`. |
| Redaction timing | Part D section 17 builds redaction in Week 1. Section 14.5 puts it in weeks 18 to 25. | BUILT | Redaction version 2 exists. Edit 14.5. |
| DuckDB version | Part C and the Week 1 doc list the dev build 1.33.1-dev57.0. | BUILT | The repository pins stable 1.32.0. Edit both docs. |
| Stale rows | Turnstile, Figma and the Supabase restore window, 90 days against one year. | DECIDE | Re-check in Week 1 and plan on the shorter figure. |
| Naming | CLAUDE.md and Part C say organization identifier. The schema uses `workspace_id`. | DECIDE | Recommendation: keep `workspace_id` and add one line to CLAUDE.md saying it is the organization identifier. CLAUDE.md is yours to edit, so this was not changed. |

## R4-4 The schedule does not add up

- **Tester sessions come before the checkpoint.** The tester doc and Part D put sessions on February 22 to March 14, "after the checkpoint". Part D reaches the checkpoint about March 7 to March 14, and build hours reach 210 in the week of March 1 to March 7.
- **Testers are asked about unbuilt features.** The evidence chain question and the pain ranking question refer to features scheduled for weeks 18 to 25.
- **Hours do not add.** Weeks 1 to 3 show 42 build hours, but the calendar gives 15, 12 and 12, which is 39. Weeks 4 and 5 show 24 but hold 27. The 14.5 table totals 372 hours, not 366.
- **DECIDE.** Either start the session window after the checkpoint, or drop the questions about unbuilt features from early sessions. Recommendation: drop questions 3, 4 and 6 from early sessions, because that keeps the dates the testers were already offered.
- **EDIT.** Fix the three row totals.

## Done in Part B on 2026-11-17

Part B is the only plan part in this repository, and these edits are made in `docs/2026-11-12-part-b-sections-6-9-13.md`:

- Section 6.3 A/A band: 36 to 64 became 37 to 64, with the false alarm rate and a rerun instead of an immediate engine fix. The 2 of 3 seeds rule was not written in, because it is still a DECIDE item above.
- Section 6.3 planted lift: the promise is now the computed floor, 382 at power 0.80, with the reason the literal rule was dropped.
- The result field in the ledger table: it holds the first, locked result, and later readouts are numbered versions.
- The quotas row: Sentry removed, error tracking limits marked UNVERIFIED.

## Also done on 2026-11-17, decided without waiting

You asked me to keep going and ask only about important things. These were small and reversible, so I took the recommendation. Each can be reversed in one edit.

- **R1-8 CUPED.** Part B now puts CUPED in version 2 and requires the analysis choice at registration. This settles the CUPED row above.
- **R1-9 revenue.** Part B no longer promises lift times audience times one order value, which can have the wrong sign. The helper in the code states its equal order value assumption in its note.
- **R1-11 and R1-12.** Part B gives the exact sample size formula, the corrected reason for choosing Benjamini Hochberg, and notes that Holm is the plan for fewer than 10 comparisons. Neither correction method is applied on any screen yet.
- **R1-6.** A significant result whose interval reaches below half of its own lift now carries a line saying significant results from small tests run high. The review proposed a rule based on power at the observed lift, but that power is only a rescaling of the p value, so it is about 0.5 or more for every significant result and the warning would almost never fire.
- **R1-7.** The ledger screen shows how many confirmatory tests have a result and the chance that at least one reads significant if none had a real effect.
- **R1-13.** The readout method text now names the pooled z test used for ordering and says it can disagree with the interval for very small counts.
- **R3-8.** A test now forces the clean output check to fire, and the known limits doc scopes the quote guarantee to the in memory store.
- **R4-6.** `2026-11-17-build-status.md` is the one status table.

## Added after the first pass

- **2 of 3 seeds rule.** Written into Part B section 6.3, with a note that the methods page runs one seed and does not apply it yet.
- **Tester questions.** The tester doc now says to ask only questions whose feature is built. Today only questions 1, 2 and 7 apply. Questions 3 to 6 and the success metric need the journey and pipeline views, the evidence chain and the pain ranking, none of which exist. This is a larger problem than the schedule dates: the validation plan cannot measure its own success metric with the current build.
- **Pilot data.** Settled as sample data only. The tester doc already says so, and the redaction limits doc says why.
- **Privacy note.** The tracked tester doc names a school in its message template, and it is in the git history. The repository returned 404 to an unauthenticated request on 2026-11-17, so it is private. Before the repository is ever made public, that line and the history need a decision.

## Not changed

- Parts A, C and D. They stay local, and the same edits apply to them: the Sentry rows, framework tags, the Mosaic spike length, redaction timing, the DuckDB version, the result versions line and the schedule rows.
- Part B line 47, the assignment export. It says the decision is open. The build follows Part A, but I did not rewrite a sentence that still asks for your confirmation.
- CUPED in Part B line 55, because it is a DECIDE item above.
- CLAUDE.md.
