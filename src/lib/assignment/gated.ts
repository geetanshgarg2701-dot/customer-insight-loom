import { assertReadoutOpen } from "../ledger/window";
import { verifyResults } from "./assign";

/**
 * The only way the app reads out a result. It refuses before the conversion
 * window closes, and it refuses before anything is computed or created, so a
 * peek leaves no trace in the database.
 */
export async function verifyResultsWhenOpen(
  input: Parameters<typeof verifyResults>[0],
): ReturnType<typeof verifyResults> {
  const entry = await input.ledger.getEntry(input.entryId);
  assertReadoutOpen(entry, input.ledger.now());
  return verifyResults(input);
}
