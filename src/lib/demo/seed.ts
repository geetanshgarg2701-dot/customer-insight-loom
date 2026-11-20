/**
 * The guided first run, plan section 6.1: three synthetic entries, one
 * confirmatory with a readable result, one exploratory, one running. Every
 * step goes through the same ledger, assignment and readout code a person
 * uses, so the demo shows the real engine. Each entry stores the true lift it
 * was generated with, so the screen can say where the readout should land.
 *
 * The entries are dated in the past with a clock this file controls, so each
 * conversion window has really closed and the fixed horizon rule is not
 * bypassed. The shared ledger keeps using real time.
 */
import { SYNTHETIC_EMAIL } from "../compliance/example";
import { assignAudience, verifyResults } from "../assignment/assign";
import { resultRecord } from "../assignment/record";
import type { SqlEngine } from "../intake/types";
import { correctionFor } from "../ledger/correction";
import { SYNTHETIC_ACTOR, createLedger, type Ledger } from "../ledger/ledger";
import { powerCheck } from "../stats/power";
import { DEMO_POOL_SIZE, demoEmail, demoResultRows } from "./synthetic";

export const DEMO_WINDOW_HOURS = 168;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

type DemoPlan = {
  title: string;
  hypothesis: string;
  frameworkTag: "PAS" | "FAB" | "AIDA";
  baselineRate: number;
  minDetectableLift: number;
  treatmentShare: number;
  trueLift: number;
  seed: number;
};

const PLANS: Record<"confirmatory" | "exploratory" | "running", DemoPlan> = {
  confirmatory: {
    title: "Synthetic: win back email with a 10 percent offer",
    hypothesis: "Lapsed customers who get a 10 percent offer repurchase within 30 days more often than a holdout.",
    frameworkTag: "PAS",
    baselineRate: 0.08,
    minDetectableLift: 0.03,
    treatmentShare: 0.5,
    trueLift: 0.04,
    seed: 61101,
  },
  exploratory: {
    title: "Synthetic: question subject line, launched before registering",
    hypothesis: "A question in the subject line lifts clicks. Registered after launch, so it is exploratory.",
    frameworkTag: "AIDA",
    baselineRate: 0.2,
    minDetectableLift: 0.05,
    treatmentShare: 0.5,
    trueLift: 0,
    seed: 61102,
  },
  running: {
    title: "Synthetic: cart reminder after 4 hours, still running",
    hypothesis: "A cart reminder 4 hours after abandonment lifts 7 day orders against a 20 percent holdout.",
    frameworkTag: "FAB",
    baselineRate: 0.12,
    minDetectableLift: 0.04,
    treatmentShare: 0.8,
    trueLift: 0.04,
    seed: 61103,
  },
};

/** Audience 20 percent above what the power check asks for, inside the demo pool. */
function sized(plan: DemoPlan) {
  const need = powerCheck({ ...plan, audienceSize: 0 }).requiredTotal;
  const audienceSize = Math.min(DEMO_POOL_SIZE, Math.ceil(need * 1.2));
  const design = {
    baselineRate: plan.baselineRate,
    minDetectableLift: plan.minDetectableLift,
    treatmentShare: plan.treatmentShare,
    audienceSize,
    conversionWindowHours: DEMO_WINDOW_HOURS,
    syntheticTrueLift: plan.trueLift,
  };
  return { design, power: powerCheck({ ...plan, audienceSize }), audienceSize };
}

async function draftAndAssign(ledger: Ledger, plan: DemoPlan) {
  const { design, power, audienceSize } = sized(plan);
  const entry = await ledger.createDraft(
    { title: plan.title, hypothesis: plan.hypothesis, frameworkTag: plan.frameworkTag, design },
    SYNTHETIC_ACTOR,
  );
  return { entry, power, audienceSize };
}

async function assign(ledger: Ledger, entryId: string, plan: DemoPlan, audienceSize: number) {
  await assignAudience({
    ledger,
    entryId,
    emails: Array.from({ length: audienceSize }, (_, i) => demoEmail(i)),
    treatmentShare: plan.treatmentShare,
  });
}

async function readAndRecord(engine: SqlEngine, ledger: Ledger, entryId: string, plan: DemoPlan, confirmatory: boolean) {
  const { rows } = await demoResultRows({
    ledger,
    entryId,
    baselineRate: plan.baselineRate,
    trueLift: plan.trueLift,
    seed: plan.seed,
  });
  const verified = await verifyResults({ engine, ledger, entryId, rows, treatmentShare: plan.treatmentShare });
  // The mismatch check flags a fair split about 1 time in 1,000 by design. The demo then
  // leaves the entry running with no result, the same way it would treat real data.
  if (verified.readout.status !== "readable") return;
  await ledger.recordResult(
    entryId,
    {
      result: resultRecord(verified.readout, verified.verification, ledger.now().toISOString()),
      comparisonsCount: 1,
      correctionMethod: correctionFor(confirmatory ? "confirmatory" : "exploratory", 1),
    },
    SYNTHETIC_ACTOR,
  );
}

/** Seeds an empty ledger with the three demo entries and returns their ids in order. */
export async function seedDemoLedger(input: { engine: SqlEngine; ledger: Ledger }): Promise<string[]> {
  const { engine, ledger } = input;
  if ((await ledger.listEntries()).length > 0) {
    throw new Error("Demo data goes into an empty ledger. This ledger already has entries.");
  }

  // A clock the seed moves by hand. The workspace and secret come from the existing ledger tables.
  const present = ledger.now().getTime();
  let t = present - 30 * DAY_MS;
  const sl = await createLedger(engine, { now: () => new Date(t) });
  const at = (daysAgo: number, plusHours = 0) => {
    t = present - daysAgo * DAY_MS + plusHours * HOUR_MS;
  };

  // Confirmatory: registered, assigned, then launched, then read out after the window closed.
  const c = PLANS.confirmatory;
  at(30);
  const first = await draftAndAssign(sl, c);
  at(30, 1);
  await sl.register(first.entry.id, SYNTHETIC_ACTOR, { powerResult: first.power });
  await assign(sl, first.entry.id, c, first.audienceSize);
  at(29);
  await sl.recordComplianceCheck(first.entry.id, SYNTHETIC_EMAIL, SYNTHETIC_ACTOR);
  const launched = await sl.launch(first.entry.id, SYNTHETIC_ACTOR);
  if (launched.entryType !== "confirmatory") throw new Error("The demo confirmatory entry was not registered first.");
  at(21);
  await readAndRecord(engine, sl, first.entry.id, c, true);

  // Exploratory: assigned and launched first, registered only afterwards.
  const x = PLANS.exploratory;
  at(28);
  const second = await draftAndAssign(sl, x);
  await assign(sl, second.entry.id, x, second.audienceSize);
  at(27);
  await sl.recordComplianceCheck(second.entry.id, SYNTHETIC_EMAIL, SYNTHETIC_ACTOR);
  await sl.launch(second.entry.id, SYNTHETIC_ACTOR);
  at(26);
  await sl.register(second.entry.id, SYNTHETIC_ACTOR, { powerResult: second.power });
  at(19);
  await readAndRecord(engine, sl, second.entry.id, x, false);

  // Running: registered, assigned and launched 11 days ago. The window closed 4 days ago, so the
  // readout is open and waiting for a results upload.
  const r = PLANS.running;
  at(12);
  const third = await draftAndAssign(sl, r);
  at(12, 1);
  await sl.register(third.entry.id, SYNTHETIC_ACTOR, { powerResult: third.power });
  await assign(sl, third.entry.id, r, third.audienceSize);
  at(11);
  await sl.recordComplianceCheck(third.entry.id, SYNTHETIC_EMAIL, SYNTHETIC_ACTOR);
  await sl.launch(third.entry.id, SYNTHETIC_ACTOR);

  return [first.entry.id, second.entry.id, third.entry.id];
}
