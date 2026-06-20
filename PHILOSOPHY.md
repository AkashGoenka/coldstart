# Philosophy: bring your own semantics

> **coldstart is a retrieval primitive, not a comprehension layer. The semantic layer is the agent.**

The most common critique of coldstart, next to embedding-based code-search tools, is that it "has no semantics" — no vector index, no LLM-generated file summaries, no learned notion of what a file *means*. That's true, and it's deliberate. This document is the full argument for why omitting that layer is the stronger design, not a gap.

## The core claim

Every consumer of coldstart is already a frontier language model — the most capable semantic reasoner in the loop. A tool that pre-computes meaning is duplicating, at index time and worse, what the agent does natively at query time. coldstart does the one thing the agent *can't* do cheaply — find the right file without burning tokens grepping — and leaves meaning to the reasoner that has the task in hand.

## Four reasons it's the stronger design

**1. Semantics computed before the question are the wrong semantics.**
Embeddings and LLM summaries freeze one interpretation of a file at index time, blind to the task. The agent holds the task. It can judge relevance *in context*, weigh two candidate files against the actual goal, and follow a hunch the index never anticipated. A static semantic layer commits to "what this file is about" before anyone asked the question — and is then stuck with that guess, no matter what the real query turns out to be.

**2. A frozen meaning drifts; a structural fact doesn't.**
Embeddings must recompute on every edit and silently lag the code — a stale vector returns a confident wrong answer, and you can't tell by looking. coldstart indexes facts that are cheap to keep *exact*: paths, symbol names, exports, import/call edges. A background keeper patches them in milliseconds as you type, so the index never lies about the current tree. Exactness you can maintain beats meaning you can't.

**3. Evidence the agent can trust beats a score it has to second-guess.**
coldstart returns *why* a file ranked — these query terms are defined here, imported there, referenced on these lines. That's checkable. A cosine similarity score isn't: the agent either trusts it blindly or spends tokens re-verifying it, and a frontier agent will re-verify. Because there's no model inference in the index, every result is deterministic, offline, free, needs no API key or GPU, and traces back to a concrete token or edge. The agent never has to wonder whether the tool hallucinated.

**4. The bottleneck was never comprehension.**
Agents already read and reason about code well — that's the part they're good at. What they waste tokens on is *finding* the right file: the orientation flailing, the speculative greps, the reading of three wrong files before the right one. coldstart does only that, hands the file off, and gets out of the way. Adding a semantic layer would re-spend tokens solving a problem the agent doesn't have, and wedge a second, dumber interpreter between the agent and the source.

## The one place semantic search looks like it wins

Vocabulary mismatch — you search `auth`, the code says `credential`. This is the real case for a semantic index, and it deserves an honest answer rather than a dodge.

coldstart's answer is to put that bridge where the knowledge already lives. The agent knows the synonyms; the guidance tells it to pass *every* salient identifier from the task — the symbol, the domain noun, the rare token it half-remembers — not one distilled keyword. On the index side, `find` doesn't only match declared names: a repo-wide name-reference pass widens the net to where those tokens actually appear. The agent supplies the vocabulary; the index supplies the exactness.

Splitting the work the other way — a model guessing synonyms at index time, frozen and blind to the task — is strictly worse: it's the same guess for every future query, computed once, never corrected by the question that finally arrives. The agent, asked live, with the task in front of it, makes a better bridge every time.

## So when *is* coldstart the wrong tool?

Being honest about the boundary is part of the argument:

- **A literal string, phrase, or regex inside file bodies** → that's `grep`, and `grep` is exact and free. coldstart routes you to files by *name and structure*, not by arbitrary body content.
- **Reading an implementation** → that's `Read`, after `gs` has shown you the file's shape and callers.
- **Deep semantic Q&A about behavior** ("does this function ever deadlock?") → that's the agent's reasoning over the code coldstart found, not coldstart's job.

coldstart is honest about being a router. It doesn't interpose its own (possibly wrong) interpretation between the agent and the code. It gets the agent to the right file fast, with evidence, and stops.

## It works best with Claude Code

The design assumes a shell-capable, tool-using frontier agent, and Claude Code is the cleanest fit:

- **CLI-primary.** Claude Code has a shell, so it reaches `coldstart find` / `coldstart gs` directly — the fast path, no MCP round-trip.
- **Auto-wired.** `coldstart init` writes the agent guidance, imports it into `CLAUDE.md`, and registers the find/gs search hooks in `.claude/settings.json` — so the right search behavior is in place from the first prompt, not something the user has to remember.
- **The model is the semantic layer.** The whole philosophy rests on the consumer being a strong reasoner that brings its own meaning. That's exactly what Claude is.

No-shell clients (e.g. Claude Desktop) get the identical engine through the MCP `find`/`gs` tools — same results, just wired by hand.

## In one line

"coldstart has no semantics" isn't a gap to apologize for. It's a refusal to pre-chew what the agent can taste. Tools that wrap an embedding model around code search are answering a question the agent can already answer for itself. coldstart answers the one it can't — *which file, without the token tax* — and stops there.

**Bring your own semantics. The model already has them.**
