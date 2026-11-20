/**
 * Loads the theme coding model in the browser, only when a person asks. Approved by the owner on 2026-11-20:
 * Transformers.js, and the model files served from this site under /models.
 *
 * What it may do, and how that is enforced here rather than trusted:
 * - Every file comes from this site. Downloads from the model hub are switched off, and the fetch function the library
 *   uses is replaced by one that refuses any other origin before a request is made.
 * - Nothing is stored. The library's browser cache, file cache, runtime cache and cross origin storage are all off,
 *   so a reload loads the files again, as the privacy page says.
 * - Comment text goes to the model in this tab and nowhere else. The model returns vectors, and coder.ts decides.
 *
 * This is the one file in the app allowed to make a request, and the privacy test checks that.
 */
import type { Embed } from "./coder";
import { MODEL_ID } from "./model-id";

/** The models folder for a site served at the root or under a prefix such as /customer-insight-loom. */
export function modelsPath(sitePrefix: string | undefined): string {
  const prefix = (sitePrefix ?? "").trim().replace(/^\/+|\/+$/g, "");
  return prefix === "" ? "/models/" : `/${prefix}/models/`;
}

/** Throws unless the address is on the page's own origin. Exported so a test can check it. */
export function assertSameSite(input: string | URL, pageHref: string): URL {
  const url = new URL(input instanceof URL ? input.href : input, pageHref);
  if (url.origin !== new URL(pageHref).origin) throw new Error(`Blocked a request to ${url.origin}. The model loads only from this site.`);
  return url;
}

let loading: Promise<Embed> | null = null;

export function loadBrowserEmbed(): Promise<Embed> {
  loading ??= (async () => {
    const { env, pipeline } = await import("@huggingface/transformers");
    const models = modelsPath(process.env.NEXT_PUBLIC_BASE_PATH);
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = models;
    env.useBrowserCache = false;
    env.useFSCache = false;
    env.useWasmCache = false;
    env.useCustomCache = false;
    env.experimental_useCrossOriginStorage = false;
    const send = globalThis.fetch.bind(globalThis);
    env.fetch = (input: string | URL, init?: RequestInit) => send(assertSameSite(input, window.location.href), init);
    const wasm = env.backends.onnx.wasm;
    if (wasm) {
      wasm.wasmPaths = `${models}ort/`;
      // No cross origin isolation on a static host, so one thread, and no extra worker.
      wasm.numThreads = 1;
      wasm.proxy = false;
    }
    const extractor = await pipeline("feature-extraction", MODEL_ID, { dtype: "q8", device: "wasm" });
    return async (texts: string[]) => {
      const out = await extractor(texts, { pooling: "mean", normalize: true });
      return (out.tolist() as number[][]).map((v) => Float32Array.from(v));
    };
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}
