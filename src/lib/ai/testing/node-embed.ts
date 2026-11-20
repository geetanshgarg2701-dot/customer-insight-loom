/**
 * Test only. The same model the browser uses, run in Node from the files in public/models, with every download and
 * cache turned off, so a test can never download anything.
 */
import path from "node:path";
import type { Embed } from "../coder";
import { MODEL_ID } from "../model-id";

let shared: Promise<Embed> | null = null;

export function nodeEmbed(): Promise<Embed> {
  shared ??= (async () => {
    const { env, pipeline } = await import("@huggingface/transformers");
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useFSCache = false;
    env.useBrowserCache = false;
    env.localModelPath = path.join(process.cwd(), "public", "models") + path.sep;
    const extractor = await pipeline("feature-extraction", MODEL_ID, { dtype: "q8" });
    return async (texts: string[]) => {
      const out = await extractor(texts, { pooling: "mean", normalize: true });
      return (out.tolist() as number[][]).map((v) => Float32Array.from(v));
    };
  })();
  return shared;
}
