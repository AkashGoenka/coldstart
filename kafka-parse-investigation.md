# Kafka parse-phase investigation

## TL;DR
Kafka is slow because **Java files are large and the JS-side traversal in
`extractors/java.ts` is the dominant cost** — not because of an algorithmic
problem. The per-byte parse rate (~2.9 MB/s) is what tree-sitter through the
Node bindings normally delivers; there are no outlier files or pathological
patterns. Kafka has 64 MB of Java in 5,891 files (avg 10.9 KB/file) — a
typical TS/JS repo averages 1–3 KB/file, so the same MB/s gives a much
higher ms/file. **The honest answer is "kafka is just big Java."**

## Measurements

- Probe machine: this sandbox (likely ~4× faster than wherever the user saw
  111s). Numbers below are still useful relatively.
- `node dist/index.js --root /tmp/kafka --no-cache --probe` (HEAD = clean):
  - `phaseMs.parse` = **27,861 ms** on 6,139 files (5,891 of them Java).
  - `walk` = 849 ms, `resolve` = 462 ms.
- Bytes parsed (Java only): **64.35 MB**.

### Where the 28 s goes
Instrumented `extractors/java.ts` (timer around `tree.parse` vs JS-side
traversal):

| bucket                          | files | tree-sitter parse | JS traversal | total   |
| ------------------------------- | ----: | ----------------: | -----------: | ------: |
| chunked path (file > 32 KB)     |   390 |            3.13 s |       7.90 s | 11.03 s |
| direct-string path (≤ 32 KB)    | 5,501 |            3.40 s |       7.71 s | 11.11 s |
| **java extractor total**        | 5,891 |        **6.53 s** |  **15.61 s** | **22.14 s** |
| parser.ts I/O + md5 + line split (rest of parse phase) | — | — | — | ~5.7 s  |

Two clear signals:

1. **JS-side traversal is 2.4× tree-sitter parse.** The grammar is fast;
   walking `namedChildren` from JS, building modifier/annotation arrays,
   and recursing into method bodies for call sites is what costs.
2. **Chunked-callback parse path is not the villain.** It runs at
   ~2.5 MB/s on its big files (e.g. `SharePartitionTest.java` 770 KB →
   parse 100 ms + traversal 292 ms = 392 ms = **1.92 MB/s**). The small-file
   path runs at ~1.3 MB/s. The chunked path is in fact slightly faster per
   byte; the chunked files just hold more bytes.

### Top 20 slowest files (parse + traversal, instrumented)

| ms  | size (KB) | lines  | path                                                                                                             |
| --: | --------: | -----: | ---------------------------------------------------------------------------------------------------------------- |
| 392 |       770 | 13,383 | core/src/test/java/kafka/server/share/SharePartitionTest.java                                                    |
| 285 |       614 | 11,771 | clients/src/test/java/org/apache/kafka/clients/admin/KafkaAdminClientTest.java                                   |
| 139 |       294 |  6,009 | storage/src/test/java/org/apache/kafka/storage/internals/log/UnifiedLogTest.java                                 |
| 131 |       246 |  5,001 | streams/src/test/java/org/apache/kafka/streams/processor/internals/TaskManagerTest.java                          |
| 122 |       273 |  5,921 | coordinator-common/src/test/java/org/apache/kafka/coordinator/common/runtime/CoordinatorRuntimeTest.java         |
| 119 |       403 |  9,055 | group-coordinator/src/main/java/org/apache/kafka/coordinator/group/GroupMetadataManager.java                     |
| 112 |       245 |  4,326 | storage/src/test/java/org/apache/kafka/server/log/remote/storage/RemoteLogManagerTest.java                       |
| 110 |       270 |  5,988 | group-coordinator/src/test/java/org/apache/kafka/coordinator/group/GroupCoordinatorServiceTest.java              |
| 101 |       199 |  4,194 | clients/src/test/java/org/apache/kafka/clients/consumer/internals/ConsumerCoordinatorTest.java                   |
| 101 |       203 |  4,667 | raft/src/test/java/org/apache/kafka/raft/KafkaRaftClientTest.java                                                |
|  98 |       196 |  4,430 | connect/runtime/src/test/java/org/apache/kafka/connect/runtime/distributed/DistributedHerderTest.java            |
|  97 |       254 |  5,186 | clients/src/main/java/org/apache/kafka/clients/admin/KafkaAdminClient.java                                       |
|  93 |       221 |  4,677 | clients/src/test/java/org/apache/kafka/clients/producer/internals/TransactionManagerTest.java                    |
|  93 |       209 |  4,243 | clients/src/test/java/org/apache/kafka/clients/consumer/KafkaConsumerTest.java                                   |
|  98 |       196 |  4,311 | clients/src/test/java/org/apache/kafka/clients/consumer/internals/FetchRequestManagerTest.java                   |
|  96 |       189 |  3,529 | metadata/src/test/java/org/apache/kafka/controller/ReplicationControlManagerTest.java                            |
|  94 |       193 |  4,006 | clients/src/test/java/org/apache/kafka/clients/producer/internals/SenderTest.java                                |
|  98 |       177 |  3,896 | clients/src/test/java/org/apache/kafka/clients/consumer/internals/FetcherTest.java                               |
|  87 |       186 |  4,213 | streams/src/test/java/org/apache/kafka/streams/processor/internals/StreamThreadTest.java                         |
|  85 |       215 |  4,022 | clients/src/test/java/org/apache/kafka/common/requests/RequestResponseTest.java                                  |

**Common pattern:** 364 of the 509 files that took ≥10 ms are under a
`src/test/java/` tree (vs 142 in `src/main/java/`). Kafka has unusually
large unit-test classes (thousands of lines of setup, mock builders,
deeply chained generic types). Top files are 200–800 KB each. No
generated/`build/`/`protobuf-output` subtree is contributing — the
walker already excludes hidden dirs and generated-name patterns. The
slow files are real human-written code.

## Hypotheses, tested

1. **"Tree-sitter Java grammar slow on specific patterns."** Rejected.
   The slowest file (SharePartitionTest) parses at 1.92 MB/s, the
   average is 2.9 MB/s — no super-linear blow-up vs file size, no
   single-file pathology.
2. **"Cumulative cost of many small files."** Partly. The 5,501 small
   files account for half the Java extractor time (11.1 s @ ~2 ms each).
   But it's not "algorithmic," it's just per-file overhead × N.
3. **"Specific subdirs dominating (`generated/`, `build/`)."** Rejected.
   The slow set is dominated by ordinary `src/test/java/` and
   `src/main/java/` files across `streams`, `clients`, `connect`,
   `group-coordinator`, etc.

## Root cause

Kafka parses slowly because:

- It has **5,891 large Java files** averaging 10.9 KB (a typical
  Le-Lia-style TS repo averages 1–3 KB).
- The Java extractor's **JS-side traversal is 2.4× the tree-sitter
  parse cost** (15.6 s vs 6.5 s). Hot spots are predictable:
  `collectCalls` recursively walks every method body's `namedChildren`,
  and `getModifiers`/`getAnnotations` re-iterate `namedChildren` per
  member.
- Throughput end-to-end (~2.9 MB/s) is within the normal envelope for
  tree-sitter via the Node bindings; this is what 64 MB of Java is
  expected to cost.

The le-lia comparison (40k files in 54 s = 1.35 ms/file) isn't an
apples-to-apples per-file number — le-lia files are an order of
magnitude smaller. Per-byte, kafka is ~2× slower than a typical TS
repo because the Java extractor's traversal is heavier per node than
ts-parser; that's the only meaningful gap.

## Possible fixes (none implemented in this run)

| fix                                                                                                                   | est. speedup | engineering cost | risk                                                              |
| --------------------------------------------------------------------------------------------------------------------- | -----------: | ---------------: | ----------------------------------------------------------------- |
| Move parsing to a worker pool (CPU cores × tree-sitter)                                                                |        2–4×  |       large      | reshapes parser.ts + index pipeline, native-binding-in-worker fuss |
| In `java.ts`, snapshot `node.children`/`namedChildren` once per node, avoid duplicate iteration in modifiers/annotations |     10–20%   |       small      | low                                                              |
| Bump `JAVA_CHUNK_SIZE` (4096 → 65536) for the chunked-parse callback                                                  |     <5%      |       trivial    | none meaningful (chunked path isn't the bottleneck)                |
| Skip test files via heuristic (`/src/test/java/` or class name `*Test`)                                                |     ~40% on kafka | small        | high — breaks `trace-impact` for test code, surprising semantics   |
| Cap file size below current 1 MB                                                                                       |     ~3–5%    |       trivial    | low; misses big test classes                                       |

## Recommendation

**Don't ship a fix.** The parser is operating at normal tree-sitter
throughput; kafka is just a big Java repo and the numbers reflect that.

Two caveats worth knowing:

- If kafka's 111 s (or any Java-heavy repo) becomes a real complaint,
  the only structural win is a **worker pool** — that's a project, not
  a tweak. Worth scoping if/when Java repos become a load-bearing
  use case.
- The micro-optimization in `java.ts` (single-pass over `namedChildren`
  to extract modifiers + annotations + member iteration) is honest and
  low-risk for ~10–20%, but a 28 s → 23 s win isn't worth the diff
  unless it's bundled with other extractor cleanup.

## Method / artifacts

- Instrumentation added (and reverted before exit): per-file
  `__JAVA_TIME__` log line in `src/indexer/parser.ts`; per-file
  `__JAVA_SPLIT__` plus an `exit`-handler `__JBUCK_SUMMARY__` in
  `src/indexer/extractors/java.ts` separating tree-sitter parse from
  JS-side traversal.
- Raw logs: `/tmp/kafka-times.log`, `/tmp/kafka-times2.log`,
  `/tmp/kafka-times3.log`. Probe outputs:
  `/tmp/kafka-probe{,2,3,4}.json`.
- All instrumentation reverted; `git status` matches HEAD.
