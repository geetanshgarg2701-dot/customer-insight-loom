# Handoff brief for a reviewer

Written Wednesday November 18, 2026. For someone who has not seen this project. It says what the app is, what was checked and how, what was not, and where to try to break it. Nothing here needs personal details, and none are included.

## What it is

A free evidence ledger for email experiments, running entirely in the browser. A person records a hypothesis, checks that the audience is big enough, assigns a holdout by a keyed hash, and reads the result with its uncertainty. The design locks at registration, results stay locked until the conversion window closes, and later readouts are numbered versions with a reason. Around that are journey and pipeline views over synthetic data, a data check screen, and a methods page that shows the checks run on generated data.

Rules it was built under: cost zero, every number comes from code and none from a model, no customer data leaves the browser, and the statistics code was written test first.

## Honest state

- **Ready to show as an early, free version on synthetic data.** The charts and demos use generated data only.
- **Not tried on real customer data.** No one has run a real experiment through it. That is the biggest unknown.
- **Not reviewed by a lawyer.** The privacy and terms pages match what the app does and a test fails if the code starts using storage, cookies, network calls or analytics. They are not legal advice.
- **No screen reader pass yet.** Automated scans found nothing, which is not proof. A checklist is in `2026-11-18-screen-reader-checklist.md`.
- **Name redaction is not built.** The app blocks columns that look like personal data. It does not remove names from free text. This was researched and deferred: `2026-11-17-name-redaction-findings.md`.
- **Hosted AI is off.** No feature calls a model.

The full table of built, partial and not started items, with evidence, is `2026-11-17-build-status.md`.

## Run it

```
npm install
npm run dev          # http://localhost:3000
npm test             # 685 unit tests
npm run test:e2e     # 58 browser tests, Playwright with Edge: set PW_CHANNEL=msedge
npm run build:static -- evidence-ledger && npm run check:site
```

The static copy needs no server. See `2026-11-17-static-mirror.md` and `2026-11-17-release-checklist.md`.

## What was verified, and how

| Claim | Evidence |
|---|---|
| The interval for a difference covers the truth about 95 percent of the time | Simulation: 95.5 and 96.2 percent over 4,000 runs each. It is known to run slightly conservative |
| The power check delivers the promised 80 percent | 1,774 per arm detected a 3 point lift 81.8 percent of the time in 1,500 runs |
| With no real difference, a difference is called about 5 percent of the time | 4.6 to 5.1 percent over 30,000 runs per setting. A first run of 3,000 read 5.9 percent and was sampling noise |
| Benjamini Hochberg controls false discoveries | 5.3 percent under the null over 2,000 runs of 50 tests |
| CSV and identity handling are safe | Random cells with quotes, commas, formula characters and accents round trip. Formula-like text gets one protective quote |
| Clock changes cannot move a window | Windows are elapsed hours. Local times that never happened or happened twice are listed, not guessed, in seven zones |
| The journey view matches the data | Browser tests compare the page's numbers with counts computed from the generator |
| The database enforces the rules | Row level security and locks on a test project, with a privilege check |

Details and limits: `2026-11-17-property-test-results.md`. A real performance defect found by those tests, a slow date formatter that froze large uploads, was fixed and guarded by tests.

## Where to try to break it

1. **The significance call.** It is exactly "the interval excludes zero", and the p value is a separate pooled z test. They disagree only at very small counts. Try small counts and extreme rates.
2. **The conversion window.** Try entries near a clock change, customers who convert after the cutoff, and open customers. Open customers are left out of the rate and counted on their own.
3. **The readout lock.** Try to read a result early, edit a locked design, or change the audience after registration, in the app and in the database.
4. **Assignment.** The keyed hash is deterministic per workspace secret. Check balance, stability when the file is reordered, and what happens to repeated or oddly cased addresses.
5. **The outlook for open deals.** It learns win rates from closed deals and applies them to open ones, with an interval for not knowing the rate. Test whether stalled deals and segments are handled honestly. It says how many, not when, and it is not a forecast.
6. **The anchored journey view.** Each customer is counted once from their first anchor event. "Ended" may mean not acted yet in real data. Look for any wording that reads as a conclusion it cannot support.
7. **Wording.** Every number on screen has a "how this was worked out" section built from the same values. Look for any claim stronger than the evidence.

## Decisions already made, so they are not reopened by accident

- Newcombe hybrid score interval for the difference, Wilson for single rates.
- A fixed horizon rule. No peeking readouts.
- Version 1 identity matching is exact on the normalized email. Dots and plus tags are never merged. Plus tag pairs are shown for a person to judge.
- Quiet editorial design, one light palette, system fonts.
- Dependencies are added only with the owner's approval. ECharts and the axe test package were approved. Name redaction packages were not.
- Publish only the built site, in a separate public repository, MIT licensed. The source repository stays private.

## Open items that need a person

Lawyer read of privacy and terms. Screen reader pass. First publish and the check of the live site. Hosted AI and its free plan limits. Pilot accounts and a client for the database, which exists as a schema and is not called by the app. Deck export. Replay and a side by side segment comparison in the journeys view.

## What would change my mind

A reviewer who finds a wrong number, a rule that can be bypassed, or wording that overclaims should write down the screen, the input, what the app said, and what it should have said. Each finding becomes a test first, then a fix.
