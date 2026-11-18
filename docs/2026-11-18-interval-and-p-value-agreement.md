# How often the interval call and the p value disagree

Written Wednesday November 18, 2026. Test: `src/lib/stats/agreement.test.ts`. Model used: Opus 5.5 at medium effort.

The app calls a result significant when the Newcombe interval for the difference excludes zero. It also reports a pooled two proportion z test p value. The app text and the knowledge file said the two can disagree only at very small counts. This measures how often they disagree.

## Design, fixed before the first run

- Equal arms of 20, 50, 100, 200, 500, 1,000, 2,000 and 5,000 people.
- Control conversion rates of 2, 10 and 30 percent.
- Two true effects. Null means no difference. Edge means a lift whose expected z is 1.96, where the two calls are most likely to split, so it is close to the worst case for a test of that size.
- 10,000 seeded runs per setting, at alpha 0.05.

**Prediction, written before the run.** Disagreement shrinks as size grows, and is not zero at large sizes in the edge setting.

**Decision rule, a judgment.** If any setting with 500 or more per arm disagrees more than 1 percent of the time, the sentence "only at very small counts" does not hold and is corrected.

## Results

Counts of disagreements out of 10,000 runs per setting.

| Effect and rate | 20 | 50 | 100 | 200 | 500 | 1,000 | 2,000 | 5,000 |
|---|---|---|---|---|---|---|---|---|
| Null, 2 percent | 15 | 113 | 258 | 73 | 94 | 47 | 13 | 8 |
| Null, 10 percent | 230 | 137 | 67 | 0 | 3 | 0 | 1 | 0 |
| Null, 30 percent | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Edge, 2 percent | 669 | 761 | 256 | 268 | **135** | **116** | 46 | 28 |
| Edge, 10 percent | 182 | 292 | 24 | 29 | 27 | 15 | 12 | 4 |
| Edge, 30 percent | 0 | 0 | 0 | 11 | 0 | 0 | 0 | 0 |

**Direction.** Of the 3,937 disagreements, 3,926 were the p value calling a result significant when the interval did not. The totals were added by a script from the table above. The other 11 went the other way, all at 30 percent and 200 per arm in the edge setting. This fits the interval running slightly conservative, which the coverage checks also showed at 95.5 and 96.2 percent.

## What it shows

- **The prediction held in part.** For every rate and effect, the largest size disagreed no more often than the smallest. The test asserts this, and it passed. The fall is not smooth, because conversion counts are whole numbers.
- **The decision rule was met, so the claim does not hold as written.** At a 2 percent rate in the edge setting, 135 of 10,000 runs disagreed at 500 per arm and 116 of 10,000 at 1,000 per arm. Both are above 1 percent. With 10,000 runs, the 500 result is about 3 standard errors above the line and the 1,000 result about 1.5, so the first is clear and the second is less certain on its own.
- **What drives it is the number of conversions, not the number of people.** At 2 percent, 1,000 per arm is only about 20 conversions per arm. At 10 percent, disagreement fell to 27 of 10,000 or fewer from 500 per arm, about 50 conversions. At 30 percent it was near zero at every size.

**Corrected sentence.** The two calls disagree rarely, and mostly when conversions are few, not only when samples are small. When they disagree, it is almost always the p value calling a result significant that the interval does not.

## Limits

- Only equal arms. A 20 percent holdout, which the app supports, was not tested.
- Only alpha 0.05 and three control rates.
- Each count has simulation error of roughly its square root, so small differences between cells are noise.
- The edge lift comes from a normal approximation, so the expected z is close to 1.96, not exactly 1.96.
- This compares the two calls with each other. It does not say which one is right on real data.

## Not changed here, needs approval

The method text on the result screen, in `src/lib/stats/readout.ts`, says the two can disagree "for very small counts". It should say few conversions. The same text says the p value "orders tests for Benjamini Hochberg", which no code does. Both are app text, so they wait for approval.
