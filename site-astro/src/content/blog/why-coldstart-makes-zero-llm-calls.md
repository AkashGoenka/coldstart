---
title: "Why coldstart makes zero LLM calls"
description: "The obvious way to find relevant files is embeddings and similarity search. Here is why coldstart uses declared identity and a real grep pass instead, and where that tradeoff actually costs something."
lead: "The obvious answer to which files matter here is a vector index and a similarity search. I wanted that to be the answer for a while. It kept failing in ways that were hard to explain to whoever was watching it fail, so I stopped reaching for it."
keywords: "embeddings for code search, semantic code search, AI coding agent architecture, no LLM calls, code index without embeddings"
kicker: "Architecture"
ogDescription: "Embeddings buy you fuzzy conceptual matches. They also buy you a store that goes stale and a ranking that isn't stable turn to turn. Most navigation questions don't need either."
publishDate: 2026-08-09
readingTime: "6 min"
tags: ["architecture", "embeddings", "search"]
next: "what-the-numbers-actually-say"
---

Embeddings are good at one specific thing: finding the file that talks about your concept without using your words. Ask for "auth" and get back a file called `session_token_validator.py` that never mentions the word auth anywhere in it. That's a real capability and coldstart doesn't have it. I could have built it in and chose not to, and it's worth being honest about why.

## What you're actually buying

A vector index costs you more than the embedding call itself. It costs you a second source of truth that has to be kept in sync with the code, and it costs you determinism.

The sync problem is not exotic. A file gets renamed, moved, or rewritten, and its embedding is now describing something that no longer exists that way, until the index is rebuilt for that file. Rebuilding on every save is expensive at the frequency a coding agent edits files, so in practice most systems batch it, which means there's a window, sometimes a long one, where the index is answering questions about a version of the code that's gone.

The determinism problem is quieter but I think it matters more for a tool an agent calls dozens of times per session. Cosine similarity over an embedding space doesn't give you a stable ranking as the corpus grows. Add ten files to a repo and a query that used to surface the right file at rank one can drift to rank four, with nothing about the query or the target file having changed. An agent that got the right answer yesterday can get a worse one today for reasons that have nothing to do with today's question. That's a hard thing to trust, and a harder thing to debug when it goes wrong, because there's no way to point at a specific line of reasoning and say that's where it went wrong.

## What coldstart uses instead

Files already declare their own identity. A filename, the segments of its path, the names it exports. Most of the time, the thing you're looking for is named close to what you'd call it, because someone wrote that name for exactly the reason you're now searching for it: so the next person reading the codebase could find it. coldstart ranks files by how many of your query terms they actually cover, using that declared identity plus a real repo-wide grep pass, backed by ripgrep where it's available, git grep where it isn't.

This is a worse tool than embeddings for a genuinely fuzzy conceptual query, one where nothing in your vocabulary overlaps with anything in the file. I don't think that's a gap worth pretending away. If you want that kind of retrieval, point an embedding-based tool at the same repo. coldstart isn't trying to be the same thing done differently, it's trying to be exact where exactness is available, and honest about the rest.

## Why the tradeoff wins for the common case

The thing I noticed watching real coding sessions is that most navigation questions during an actual task aren't conceptual. They're literal. Where's the function named `resolveImports`. Who calls this symbol. Which file defines the class this error is coming from. The code already answers these definitively, in its names and its structure. Paying for an LLM call and a vector store's staleness and drift to answer a question the filenames already settle is a bad trade, made worse by the fact that it happens on almost every call, not occasionally.

There's a second reason that matters less philosophically and more practically: coldstart runs a background process that keeps its index current as you edit, patching just the changed files within a few seconds of a save. That only works cheaply because there's no embedding model to call and no vector recomputation to wait on. A patch is a few milliseconds of parsing per changed file. Reindexing embeddings at that frequency, for every keystroke-adjacent save across a session, isn't something you'd want to pay for even if you could.

## The actual bet

The bet isn't that semantics don't matter. It's that most of what a coding agent asks while it's actually working is already answered by the structure the code declares about itself, and that answering those questions exactly, deterministically, and for free is worth more than answering a smaller number of genuinely fuzzy questions approximately. `find` and `gs` are built for the first kind of question. Where you need the second kind, that's a different tool, and coldstart isn't trying to replace it.
