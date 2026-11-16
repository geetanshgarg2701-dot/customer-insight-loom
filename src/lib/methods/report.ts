/**
 * The methods page report, plan section 6.3. It runs the real honesty harness
 * and the real redaction planted set, so every count on the page comes from
 * code. Seeds are fixed, so anyone can reproduce the numbers. The method notes
 * take their numbers from the same constants the engine uses.
 */
import { redact } from "../redaction/redact";
import {
  evaluatePlanted,
  generatePlanted,
  type MissedItem,
  type TypeScore,
} from "../redaction/testdata/planted";
import { RULE_VERSION } from "../redaction/types";
import {
  HONESTY_NOTE,
  runAaSimulation,
  runPlantedLift,
  type AaResult,
  type PlantedResult,
} from "../stats/honesty";
import { SRM_THRESHOLD } from "../stats/srm";
import { STATS_ENGINE_VERSION } from "../stats/version";

export const AA_SEED = 20261115;
export const PLANTED_SEED = 20261116;

const ALPHA = 0.05;
const POWER = 0.8;

export type MissedSummary = Pick<MissedItem, "id" | "type" | "variant" | "reason">;

export type MethodsReport = {
  note: string;
  statsEngineVersion: string;
  aa: AaResult;
  planted: PlantedResult;
  redaction: {
    ruleVersion: string;
    scores: TypeScore[];
    total: number;
    caught: number;
    missed: number;
    /** Format and reason only. The planted values themselves are never carried. */
    missedItems: MissedSummary[];
  };
};

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function runMethodsReport(
  options: { onProgress?: (step: string) => void } = {},
): Promise<MethodsReport> {
  const progress = options.onProgress ?? (() => {});

  progress("A/A simulation");
  await tick();
  const aa = runAaSimulation({ experiments: 1000, nPerArm: 2000, rate: 0.05, seed: AA_SEED, alpha: ALPHA });

  progress("Planted lift simulation");
  await tick();
  const planted = runPlantedLift({
    experiments: 500,
    baselineRate: 0.05,
    lift: 0.01,
    treatmentShare: 0.5,
    seed: PLANTED_SEED,
    alpha: ALPHA,
    power: POWER,
  });

  progress("Redaction planted set");
  await tick();
  const { scores, missed } = evaluatePlanted(generatePlanted(), redact);
  const total = scores.reduce((n, s) => n + s.total, 0);
  const caught = scores.reduce((n, s) => n + s.caught, 0);

  return {
    note: HONESTY_NOTE,
    statsEngineVersion: STATS_ENGINE_VERSION,
    aa,
    planted,
    redaction: {
      ruleVersion: RULE_VERSION,
      scores,
      total,
      caught,
      missed: total - caught,
      missedItems: missed.map(({ id, type, variant, reason }) => ({ id, type, variant, reason })),
    },
  };
}

const CONFIDENCE = `${(1 - ALPHA) * 100} percent`;

/** Plain words for each method. Numbers come from constants, so the text cannot drift from the code. */
export const METHOD_NOTES: readonly { name: string; text: string }[] = [
  {
    name: "Lift and interval",
    text:
      `Lift is the treatment conversion rate minus the control conversion rate. The ${CONFIDENCE} interval uses ` +
      `the Newcombe hybrid score method, method 10 in Newcombe 1998, built from Wilson score intervals. ` +
      `A result is called significant only when the interval excludes zero.`,
  },
  {
    name: "Power check",
    text:
      `A two sided two proportion z test using the normal approximation, with alpha ${ALPHA} and power ${POWER}. ` +
      `It handles uneven splits such as a holdout. When the available audience is smaller than the test needs, ` +
      `registering is blocked and the entry can only launch as exploratory.`,
  },
  {
    name: "Sample ratio check",
    text:
      `A chi square goodness of fit test on everyone assigned, against the planned split. When p is below ` +
      `${SRM_THRESHOLD} the readout is blocked, because a split that far off means the assignment or the ` +
      `tracking is broken. The ${SRM_THRESHOLD} threshold is common industry practice, labeled judgment.`,
  },
  {
    name: "Multiple comparisons",
    text:
      `The Benjamini Hochberg step up procedure controls the false discovery rate at ${ALPHA}. Any view that ` +
      `compares more than one group will show how many comparisons it made. The procedure is built and tested, ` +
      `but the current screens read out one comparison, so it does not change a result yet.`,
  },
  {
    name: "Assignment",
    text:
      `Each person gets a keyed hash made in the browser: HMAC SHA-256 of the lower cased email under a ` +
      `per workspace secret. A bucket from 0 to 99 mixes in the entry id, so people land in independent groups ` +
      `across experiments. Treatment goes to buckets below the treatment share. Assignments are insert only, ` +
      `so a re run cannot reshuffle anyone, and the app keeps the hash, not the email.`,
  },
  {
    name: "Fixed horizon",
    text:
      `The engine reads out once, after the conversion window closes. There is no sequential stopping, because ` +
      `a wrong sequential rule silently inflates false positives. People whose window is still open are ` +
      `excluded and counted.`,
  },
];

export const REDACTION_LIMITS: readonly string[] = [
  "Names are not covered. The rules do not detect personal names, so redacted text is not anonymous.",
  "Formats a simple rule set cannot catch are kept in the planted set on purpose, so the misses are real and are not tuned away.",
  "Phone and address matching is centered on the United States.",
  "The street rule can over match some ordinary phrases. False positives are not measured.",
  "The planted set is synthetic and written by us, so these counts describe this set, not real customer text.",
];
