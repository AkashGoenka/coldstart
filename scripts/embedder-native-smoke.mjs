// CI smoke for the embedder's NATIVE dependencies on every OS in the matrix (no model needed): both optional natives
// (onnxruntime-node, tokenizers) installed by `npm ci` AND loadable on this platform/Node, and the Rust tokenizer
// gives the exact token ids the shipped vectors were built with. The real-model tests skip in CI (no 175 MB model),
// so without this a missing prebuilt or a silently skipped optional dependency on Windows would ship unnoticed.
// Fetches only tokenizer.json + tokenizer_config.json, through the product downloader (pinned REVISION, sha-checked),
// into COLDSTART_MODEL_DIR (CI caches it).
// Usage: COLDSTART_MODEL_DIR=<dir> node scripts/embedder-native-smoke.mjs [--print]   (--print: show the golden values)
import "../hooks/regex-engine.mjs";
import { createHash } from "node:crypto";
import { FILES, ensureModel } from "../hooks/embed-model.mjs";
import { loadTokenizer, runtimeAvailable } from "../hooks/embed-runtime.mjs";
import { modelDir } from "../hooks/embed-recipe.mjs";

const fail = (msg) => { console.error(`embedder native smoke: FAIL — ${msg}`); process.exit(1); };
for (const pkg of ["onnxruntime-node", "tokenizers"]) {
  try { await import(pkg); } catch (e) { fail(`${pkg} did not load on ${process.platform}-${process.arch} node ${process.version}: ${e?.message || e}`); }
}
if (!(await runtimeAvailable())) fail("runtimeAvailable() is false although both natives imported");

const dir = modelDir();
await ensureModel({ dir, files: FILES.filter((f) => f.path.startsWith("tokenizer")) });
const tok = await loadTokenizer({ dir });

// Every role, unicode/emoji/CRLF, a truncated code query and a windowed note (rows > 1).
const cases = [
  ["note_query", "where is the session cookie refreshed after login"],
  ["code_query", "héllo wörld — “quotes” 😀👍🏽 中文 日本語 한국어\r\nb\tc"],
  ["file_doc", "src/server/find.ts\nbuildRichPage rankFiles scanPass"],
  ["note_doc", "The keeper watches the repo and saves the cache. ".repeat(3)],
  ["code_query", "function x() { return 1 } ".repeat(200)],
  ["note_doc", "The keeper watches the repo and saves the cache. ".repeat(300)],
];
const plans = [];
for (const [role, text] of cases) plans.push(await tok.plan(text, role));
const digest = createHash("sha256").update(JSON.stringify(plans.map((p) => p.rows))).digest("hex");
const shape = plans.map((p) => `${p.tokens}/${p.rows.length}`).join(" ");
if (process.argv.includes("--print")) { console.log(JSON.stringify({ digest, shape })); process.exit(0); }

// Golden values from the build machine (macOS arm64, the ids every stored vector was embedded from).
const GOLDEN = { digest: "0efdabdf5f2312e707dafbe3a703ebc7c1b9e63abf8459b5077cc98e840aada9", shape: "17/1 33/1 17/1 39/1 1610/1 3009/3" };
if (shape !== GOLDEN.shape) fail(`token counts/windows ${shape} ≠ ${GOLDEN.shape}`);
if (digest !== GOLDEN.digest) fail(`token ids differ from the golden ids (sha256 ${digest})`);
console.log(`embedder native smoke: OK on ${process.platform}-${process.arch} node ${process.version} — ${shape}`);
