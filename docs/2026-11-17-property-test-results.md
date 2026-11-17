# Property tests: what they checked and what they found

Written Tuesday November 17, 2026. Files: `src/lib/stats/properties.test.ts` and `src/lib/app/properties.test.ts`.

The earlier tests check chosen examples. These check statements that must hold for every input, on random inputs, and the statistics are also checked against simulation, which is the only way to test a claim such as "this interval covers 95 percent of the time". Random numbers are seeded, so any failure can be reproduced. Nothing here uses real data.

**Result: 30 properties. No wrong answer found, but one real performance defect.** That is a result, not a guarantee. It means these properties held on every case tried, not that the code is correct everywhere.

**The defect.** The days-and-windows property test timed out in the full suite. Measuring it showed `localDayKey` and the local time reader built a new `Intl.DateTimeFormat` for every call, about 65 microseconds each. Cutting 100,000 events into days took 6.3 seconds and reading 20,000 local times took 4.7 seconds, enough to freeze the page on a large upload. Each zone's formatter is now built once and kept (a bad zone name still throws and is not kept). After the fix: 425 ms and 242 ms. Two speed guard tests in `src/lib/time/time.test.ts` now fail if this comes back. The answers did not change.

## Statistics, checked against simulation

| Claim | What I measured |
|---|---|
| The Newcombe interval for a difference covers the truth about 95 percent of the time | 95.5 percent with 300 per arm at 12 and 9 percent, and 96.2 percent with 120 per arm at 4 and 2 percent, 4,000 runs each. It is known to run slightly conservative, and it does. |
| The power formula detects the minimum lift at the promised 80 percent when run through the actual readout | 1,774 per arm, as sized by the power check, detected a 3 point lift 81.8 percent of the time, 1,500 runs. |
| With no real difference, a difference is called about 5 percent of the time | 5.9 percent in a first run of 3,000, which looked high. Rerun with 30,000 runs for each of six settings, it was 4.6 to 5.1 percent, at the nominal 5. The first figure was noise. |
| The significance call and the p value agree at ordinary sizes | They disagreed in 0 of 2,000 cases with at least 500 per arm. This is the review finding R1-13: the two tests only part ways for very small counts. |
| Benjamini Hochberg makes a false discovery in at most about 5 percent of runs when nothing is real | 5.3 percent of 2,000 runs of 50 true nulls. |
| The sample ratio check is a probability that is about uniform for a truly random split | It fell below 0.05 in 5.3 percent of 2,000 runs. |

## Statements checked on random inputs

- Wilson and Newcombe intervals bracket the observed value, stay inside their bounds, and are mirror images when the groups swap. They narrow with more people and widen at a stricter alpha.
- The p value is a probability, is the same when the arms swap, is 1 when the rates are equal, and falls as the difference grows.
- A result is significant exactly when its interval excludes zero.
- A bigger lift needs fewer people, and a bigger audience finds a smaller detectable lift.
- Benjamini Hochberg never lowers a p value, keeps their order, does not depend on the order they are given, rejects at least what Bonferroni would, and rejects more as q grows.
- The binomial distribution function rises with k, reaches 1 at n, and matches adding up the probabilities directly.
- The what if never lowers the end count when a step improves, never goes below zero, is a no-op at zero points, and never lets a stage hold more people than the one before it.

## Text and time

- **CSV.** 400 random rows of cells made from quotes, commas, line breaks, formula characters, tabs and accents were written and read back by a separate reader. Every cell came back the same, except that formula-like text gained one leading quote, and no cell was left that a spreadsheet would run as a formula. The ledger export keeps every entry on one row of the right width. To check the test can fail, I broke the protection on purpose, and three properties failed, then passed again once restored.
- **Email normalization** is idempotent on 2,000 random strings built from awkward characters such as a Kelvin sign, a ligature, a full width letter and a dotted capital I. Normalizing a stored value again cannot move a person to another group.
- **Identity matching** gives the same answer whichever list is called the left one, and every record is counted once.
- **Local times** were checked in seven zones, including a half hour clock change and a quarter hour offset, on and around clock change days. A time the code accepts reads back as the time typed. A repeated time comes back as two instants, earlier first, 30 or 60 minutes apart. A missing time has no instant within three hours either side that reads as it. The fuzz reached all three outcomes: 1,471 ordinary, 16 repeated, 13 missing.
- **Days and windows.** An event never moves to an earlier day as time moves forward, every valid event is counted once, and a conversion counts exactly when it falls between entry and entry plus the window.

## What this does not cover

- The property tests use seeded simulation, so the coverage and power figures have sampling error of a few tenths of a point. The bands in the tests are set wide enough for that and tight enough to catch a real fault, such as a coverage of 90 percent.
- They test the code against statements I wrote. A statement that is wrong in the same way as the code would pass. The simulations help, because they do not share the code's formulas.
- The database queries, the charts and the screens are covered by the earlier tests and the browser tests, not by these.
