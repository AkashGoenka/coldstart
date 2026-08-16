---
title: "Why coldstart makes zero LLM calls"
description: "coldstart is two parts: a notebook of AI-written notes, and a navigation layer that decides which files are relevant to a query. The obvious way to build that second part is embeddings and similarity search. Here's why it uses declared identity and a real grep pass instead."
lead: "coldstart has two parts: a notebook where an agent writes down what it worked out about your code, and a navigation layer that finds which files matter for a question. This is about the second part. The obvious way to build it is to have an AI model read every file and match by meaning instead of exact words. I wanted that to be the answer for a while. It kept failing in ways that were hard to explain to whoever was watching it fail, so I stopped reaching for it."
keywords: "embeddings for code search, semantic code search, AI coding agent architecture, no LLM calls, code index without embeddings"
kicker: "Architecture"
ogDescription: "Embeddings buy you fuzzy conceptual matches. They also buy you a store that goes stale and a ranking that isn't stable turn to turn. Most navigation questions don't need either."
publishDate: 2026-08-08
readingTime: "6 min"
tags: ["architecture", "embeddings", "search"]
next: "why-most-token-savings-tools-lie"
---

coldstart is built from two parts. One is a notebook: an agent writes down what it worked out about your code after a real task, so the next session doesn't re-discover the same thing from scratch. Those notes are AI-written, full stop. The other part is a navigation layer (`find` and `gs`) that decides which files are relevant to a question and maps how they connect. This post is about that second part, and the claim is narrower than the title alone tells you: the navigation layer never calls out to an AI model of its own to decide what's relevant, even though the notebook sitting right next to it is nothing but AI-written notes.

Some code-search tools build that navigation layer by having a model "understand" your concept instead of matching your words. Ask for "auth" and get back a file called `session_token_validator.py`, even though the word auth never appears in it. That's a real capability, coldstart doesn't have it, and I could have built it in. I chose not to, and it's worth being honest about why.

## What that trick actually costs

The way that "auth" match works: a small AI model reads each file and converts it into an *embedding*, a long list of numbers meant to capture what the file is about. Your query gets turned into a list of numbers the same way, and the tool returns whichever files' numbers land closest to yours. That whole system, the model doing the converting plus the database holding all those number-lists, is usually called a vector index or vector store.

It's a neat trick, and it costs more than the price of the model call. It costs you a second source of truth that has to be kept in sync with the code, and it costs you a stable answer.

The sync problem is not exotic. A file gets renamed, moved, or rewritten, and its number-list is now describing something that no longer exists that way, until the model runs over it again. Doing that on every save is too expensive at the rate a coding agent edits files, so in practice most tools batch it, which means there's a window, sometimes a long one, where the index is answering questions about a version of the code that's already gone.

The stability problem is quieter but matters more for a tool an agent calls dozens of times per session. Comparing those number-lists doesn't give you a fixed ranking as the codebase grows. It shifts as unrelated files get added anywhere in the repo. Add ten files elsewhere in the repo and a query that used to surface the right file first can drift to fourth place, with nothing about your query or the target file having changed. An agent that got the right answer yesterday can get a worse one today for reasons that have nothing to do with today's question. That's a hard thing to trust, and a harder thing to debug when it goes wrong, because there's no line of code you can point to and say that's where it went wrong. It's just an emergent side effect of everything else in the number-space shifting around.

<figure class="wide essay-fig ">
<div class="fig-plot">
<svg viewBox="0 0 920 360" role="img" aria-labelledby="r7t r7d">
<title id="r7t">Rank of the right file as the repo grows</title>
<desc id="r7d">Two lines against the same query over time. Declared identity stays flat at rank one. Embedding similarity zigzags between rank one and rank four as unrelated files are added elsewhere in the repo, with nothing about the query itself changing.</desc>
<defs>
<filter id="r7" x="-6%" y="-6%" width="112%" height="112%">
<feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="2" seed="19" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G"/>
</filter>
</defs>
<g filter="url(#r7)">
<path class="f-pen" d="M70 20 L100 20"/>
<path class="f-mark" d="M470 20 L500 20"/>
<path class="f-axis" d="M90 300 L860 300"/>
<path class="f-axis" d="M90 60 L90 300"/>
<path class="f-tick" d="M90 160 L860 160"/>
<path class="f-tick" d="M90 220 L860 220"/>
<path class="f-tick" d="M90 280 L860 280"/>
<path class="f-pen" d="M100 100 L820 100"/>
<path class="f-mark" d="M100 100 L200 100 L260 180 L340 140 L420 240 L500 160 L580 260 L660 180 L740 220 L820 150"/>
<circle class="f-pin" cx="420" cy="240" r="6"/>
<circle class="f-pin" cx="580" cy="260" r="6"/>
</g>
<text class="f-key" x="110" y="25" text-anchor="start">declared identity: same file, same rank, always</text>
<text class="f-key" x="510" y="25" text-anchor="start">embedding similarity: drifts as the corpus grows</text>
<text class="f-lab" x="80" y="105" text-anchor="end">1</text>
<text class="f-lab" x="80" y="165" text-anchor="end">2</text>
<text class="f-lab" x="80" y="225" text-anchor="end">3</text>
<text class="f-lab" x="80" y="285" text-anchor="end">4+</text>
<text class="f-lab" x="90" y="332" text-anchor="start">files added to the repo →</text>
<text class="f-note" x="420" y="270" text-anchor="middle">nothing about the query changed</text>
</svg>
</div>
<figcaption>Declared identity answers the same query with the same file at the same rank, every time. Embedding-based matching has no such guarantee: adding unrelated files anywhere in the repo can push yesterday's rank-one result to rank four, with nothing about the query having changed.</figcaption>
</figure>

## What coldstart uses instead

Files already declare their own identity: a filename, the segments of its path, the names it exports. Most of the time, the thing you're looking for is named close to what you'd call it, because someone wrote that name for exactly the reason you're now searching for it: so the next person reading the codebase could find it. coldstart ranks files by how many of your query terms they actually cover, using that declared identity plus a real repo-wide text search (backed by [ripgrep](https://github.com/BurntSushi/ripgrep), a fast plain-text search tool, where it's available; plain `git grep` where it isn't).

This is a worse tool than an embedding-based search for a genuinely fuzzy conceptual query, one where nothing in your vocabulary overlaps with anything in the file. I don't think that's a gap worth pretending away. If you want that kind of retrieval, point an embedding-based tool at the same repo. coldstart isn't trying to be the same thing done differently, it's trying to be exact where exactness is available, and honest about the rest. ([More on where that line actually falls.](/vs/vector-rag/))

## Why the tradeoff wins for the common case

The thing I noticed watching real coding sessions is that most navigation questions during an actual task aren't conceptual. They're literal: where's the function named `resolveImports`, who calls this symbol, which file defines the class this error is coming from. The code already answers these definitively, in its names and its structure. Paying for an AI model call, plus the staleness and drift that come with it, to answer a question the filenames already settle is a bad trade, made worse by the fact that it happens on almost every call, not occasionally.

There's a second reason that matters less philosophically and more practically: coldstart runs a background process that keeps its index current as you edit, patching just the changed files within a few seconds of a save. That only works cheaply because there's no AI model to call and no number-list to recompute. A patch is a few milliseconds of parsing per changed file. Re-running a model over every file that frequently, for every keystroke-adjacent save across a session, isn't something you'd want to pay for even if you could.

## The actual bet

The bet isn't that meaning doesn't matter. It's that most of what a coding agent asks while it's actually working is already answered by the structure the code declares about itself, and that answering those questions exactly, the same way every time, and for free, is worth more than answering a smaller number of genuinely fuzzy questions approximately. `find` and `gs` are built for the first kind of question. Where you need the second kind, that's a different tool, and coldstart isn't trying to replace it.
