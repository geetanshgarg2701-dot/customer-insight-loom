import { downloadBytes } from "@/lib/app/download";
import { buildDeck, type DeckEntry } from "@/lib/deck/deck";
import type { ChainStep } from "@/lib/insights/evidence";

const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/**
 * Builds the decision deck for one ledger entry and saves it as a .pptx. The deck library loads only now, when a person
 * asks for a deck. Returns the file name.
 */
export async function exportDeck(entry: DeckEntry, chain?: { steps: ChainStep[]; title: string }): Promise<string> {
  const deck = buildDeck({ entry, chain: chain?.steps, chainTitle: chain?.title, generatedAt: new Date().toISOString() });
  const { renderDeck } = await import("@/lib/deck/pptx");
  downloadBytes(deck.fileName, PPTX, await renderDeck(deck));
  return deck.fileName;
}
