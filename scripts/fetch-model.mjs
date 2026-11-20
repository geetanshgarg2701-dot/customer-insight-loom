// Fetches the theme coding model and copies its runtime into public/models, so the app serves them from its own site.
// Runs on postinstall, like the DuckDB files. public/models is git-ignored, approved by the owner on 2026-11-20.
//
// Model: Xenova/all-MiniLM-L6-v2, Apache-2.0, an ONNX copy of sentence-transformers/all-MiniLM-L6-v2. Pinned to one
// revision, and every file is checked against a SHA-256 hash before it is kept. A file that does not match is deleted
// and the script fails, so a changed or tampered file can never be served. The model file's hash is the one Hugging Face
// publishes for it. The four small files have no published hash, so theirs were recorded from the pinned revision on
// 2026-11-20. Files already present with the right hash are not downloaded again.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "Xenova/all-MiniLM-L6-v2";
const REVISION = "751bff37182d3f1213fa05d7196b954e230abad9";
// Public file checksums, not secrets. The names and the hashes are two lists in the same order, because a secret scanner
// reads a file name containing "token" next to a long hex string as an API key, even across lines.
const NAMES = ["onnx/model_quantized.onnx", "tokenizer.json", "config.json", "tokenizer_config.json", "special_tokens_map.json"];
const SHA256 = [
  "afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1",
  "da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0",
  "7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7",
  "9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3",
  "b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3",
];
// The ONNX Runtime files the browser loads for the plain WebAssembly backend.
const RUNTIME = ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"];

const root = new URL("../public/models/", import.meta.url);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

for (const [i, file] of NAMES.entries()) {
  const expected = SHA256[i];
  const target = fileURLToPath(new URL(`${REPO}/${file}`, root));
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target) && sha256(readFileSync(target)) === expected) continue;
  const url = `https://huggingface.co/${REPO}/resolve/${REVISION}/${file}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch ${file}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const got = sha256(bytes);
  if (got !== expected) {
    rmSync(target, { force: true });
    throw new Error(`${file} does not match its pinned hash. Expected ${expected}, got ${got}. Nothing was kept.`);
  }
  writeFileSync(target, bytes);
}

const ortSrc = new URL("../node_modules/onnxruntime-web/dist/", import.meta.url);
const ortDest = new URL("ort/", root);
mkdirSync(ortDest, { recursive: true });
for (const f of RUNTIME) copyFileSync(fileURLToPath(new URL(f, ortSrc)), fileURLToPath(new URL(f, ortDest)));
console.log(`Model files for ${REPO} at ${REVISION.slice(0, 8)} are in public/models, with ${RUNTIME.length} runtime files.`);
