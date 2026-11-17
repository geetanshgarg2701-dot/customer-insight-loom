# Name redaction: what I found, and a recommendation

Written Tuesday November 17, 2026. This is research only. Nothing was installed, downloaded to the project, or run.

Labels: SOURCED has a URL and the date I read it. INFERRED is my reasoning from sourced facts. UNVERIFIED means I did not confirm it today.

## The question

The redaction module finds emails, phones, cards, social security numbers, IP addresses and street addresses. It does not find personal names, and the privacy page says so. Can a small model running in the browser close that gap, within the project rules: cost zero, nothing leaves the browser, every file self hosted, and ask before adding a dependency?

## Short answer

Yes, it is technically possible. I recommend not building it yet, for three reasons.

1. **Nothing in the app handles free text today.** Redaction is only worth running where text is read. The quote store has no screen, the AI features are not built, and intake previews only the columns a person chooses. A name finder with no consumer would add a large download and a dependency for no visible result. INFERRED from the build status.
2. **It would still miss names.** The best small model I found reports about 80 percent precision and recall for names on its own test data, so roughly 1 name in 5 gets through. The privacy page would still have to say names are not reliably removed, which it already says truthfully today. INFERRED from the figures below.
3. **It costs more than it looks.** The model is small but the runtime and the rules it would break are not. Details below.

When a feature that reads free text exists, the plan in the last section is ready to follow.

## What I checked

### The library, Transformers.js

SOURCED, `npm view @huggingface/transformers`, read 2026-11-17: version 4.3.2, license Apache-2.0, last modified 2026-10-30.

- It depends on `sharp`, an image library with native code, on `onnxruntime-node` at 307 MB unpacked, and on a development snapshot of `onnxruntime-web`, version 1.31.0-dev.20260914. None of these is needed in a browser, but all would be installed.
- Its docs, SOURCED from Context7, `/huggingface/transformers.js/4.3.2`, 2026-11-17, show how to load models only from local files: `env.allowRemoteModels = false`, `env.localModelPath`, and `env.backends.onnx.wasm.wasmPaths`. So self hosting is supported.
- By default it caches downloaded models in the browser's cache storage. That would break the privacy page's statement that the app uses no store in the browser. The docs I read do not cover switching this off, so it is UNVERIFIED that it can be disabled cleanly.

### A lighter route, the runtime and a tokenizer directly

SOURCED, `npm view`, 2026-11-17: `onnxruntime-web` 1.31.1, MIT, and `@huggingface/tokenizers` 0.2.0, Apache-2.0, 361 KB unpacked. This avoids `sharp`, `onnxruntime-node` and the development snapshot, and has no hidden cache. The cost is writing and testing the code that turns model output into name spans. I would pick this route if the feature is built.

### The models

Read from the Hugging Face API and model cards on 2026-11-17, for example `https://huggingface.co/api/models/onnx-community/bert-small-pii-detection-ONNX`.

| Model | License | Smallest usable file | Finds names | Notes |
|---|---|---|---|---|
| `onnx-community/bert-small-pii-detection-ONNX`, from `gravitee-io/bert-small-pii-detection` | Apache-2.0 | 28.7 MB, int8 | Yes, label PERSON, and 24 other personal data labels | Trained on three datasets, two of them synthetic. The author says domain drift is real and to audit on your own data. |
| `onnx-community/distilbert-NER-ONNX`, from `dslim/distilbert-NER` | Apache-2.0 base, none stated on the ONNX copy | 65.8 MB | Yes, label PER | Trained on CoNLL 2003, English news. |
| `Xenova/bert-base-NER` | MIT | 108.5 MB | Yes | Same training data as above. |
| `Xenova/distilbert-base-multilingual-cased-ner-hrl` | None stated | 135 MB | Yes | Not usable, because no license is stated. |

The author of the small PII model reports, on `gretelai/gretel-pii-masking-en-v1`, 5,000 synthetic examples, int8: PERSON F1 0.795, precision 0.781, recall 0.809, from 3,209 names. Locations are 0.856 and organizations 0.697. Email, phone and social security numbers score above 0.97, which the existing rules already cover. These are the author's figures on synthetic text, not mine, and not on survey comments or reviews. UNVERIFIED on realistic text.

The training data licenses I read are Apache-2.0 or MIT. UNVERIFIED: CoNLL 2003 is listed as a source for two of these models, and it is built on news text that has had usage restrictions. I did not resolve that, and it matters before anything is shipped.

## What it would cost

- **Download.** About 29 MB for the model, under 1 MB for the tokenizer, and a runtime file I estimate at 10 to 25 MB, UNVERIFIED because I did not measure it. So roughly 40 to 55 MB, loaded only when a person asks for the name check, never on a normal visit.
- **Hosting.** The model must not be committed to git. It would be fetched at install, pinned to an exact revision and checked against a hash, like the DuckDB files, then self hosted. It fits under the 100 MB file limit on GitHub Pages.
- **Privacy rules.** The privacy test forbids `fetch` and any outside address, so the model loader would need one narrow exception for a same site file, and the privacy page would need a sentence saying a model file is downloaded from this site when the check is used.
- **Speed.** UNVERIFIED. I did not time a model in the browser.

## If a feature needs it, the plan

1. Build the consumer first, such as a screen that reads review or survey text, so the name check has a place to run.
2. Use `onnxruntime-web` and `@huggingface/tokenizers` with the 28.7 MB model, loaded only on request.
3. Make it opt in, show the count of names found, and let the person review the redacted text before anything is saved.
4. Write a planted test set of names, in the same way as the existing 200 item set, and report caught and missed counts per entity before shipping. Do not rely on the model author's figures.
5. Update the privacy page and its test together, and keep the sentence that names are not reliably removed.
6. Resolve the training data license question for CoNLL 2003 first.

## What I did not do

I did not install a package, download a model file, load a model in a browser, or measure any size or speed myself. The sizes come from the Hugging Face API listing. Every accuracy figure is the model author's.
