---
title: "Why coldstart makes zero LLM calls"
description: "coldstart is two parts: a notebook of AI-written notes, and a navigation layer that decides which files are relevant to a query. The obvious way to build that second part is embeddings and similarity search. Here's why it uses declared identity and a real grep pass instead."
lead: "coldstart has two parts: a notebook where an agent writes down what it worked out about your code, and a navigation layer that finds which files matter for a question. This is about the second part. The obvious way to build it is to have an AI model read every file and match by meaning instead of exact words. I wanted that to be the answer for a while. It kept failing in ways that were hard to explain to whoever was watching it fail, so I stopped reaching for it."
keywords: "embeddings for code search, semantic code search, AI coding agent architecture, no LLM calls, code index without embeddings"
kicker: "Architecture"
ogDescription: "Embeddings buy you fuzzy conceptual matches. They also buy you a second store that lags the code and an answer with no evidence attached. Most navigation questions need neither."
publishDate: 2026-08-08
readingTime: "6 min"
tags: ["architecture", "embeddings", "search"]
next: "why-most-token-savings-tools-lie"
---

Here is the kind of thing a coding agent actually asks while it is working. Where is the function named `resolveImports`. Who calls this symbol. Which file defines the class this stack trace is pointing at. Which of these three similarly named files is the one the config actually loads.

Every one of those is answered by something the code already declares about itself: a filename, a path segment, an exported name, an import edge. Not one of them requires anything to work out what the code *means*. I bring this up first because it is the observation the rest of the post rests on, and because it is easy to design past.

coldstart is built from two parts. One is a notebook: an agent writes down what it worked out about your code after a real task, so the next session doesn't re-discover the same thing from scratch. Those notes are AI-written, full stop. The other is a navigation layer (`find` and `gs`) that decides which files are relevant to a question and maps how they connect. This post is about that second part, and the claim is narrower than the title alone tells you: the navigation layer never calls out to an AI model of its own to decide what's relevant, even though the notebook sitting right next to it is nothing but AI-written notes.

## Why the semantic version looks like the right answer

Some code-search tools build that navigation layer by having a model "understand" your concept instead of matching your words. Ask for "auth" and get back a file called `session_token_validator.py`, even though the word auth never appears in it.

That is a real capability, coldstart doesn't have it, and when it lands it is plainly the better answer: the query you were able to think of finds the file you were not able to name. I could have built it in. I wanted it to be the answer for a while. It's worth being honest about why I stopped reaching for it.

## What the trick costs after the demo

The way that "auth" match works: a small AI model reads each file and converts it into an *embedding*, a long list of numbers meant to capture what the file is about. Your query gets turned into a list of numbers the same way, and the tool returns whichever files' numbers land closest to yours. That whole system, the model doing the converting plus the database holding all those number-lists, is usually called a vector index or vector store.

It's a neat trick, and it costs more than the price of the model call. It costs you a second source of truth that has to be kept in sync with the code, and it costs you a stable answer.

The sync problem is not exotic. A file gets renamed, moved, or rewritten, and its number-list is now describing something that no longer exists that way, until the model runs over it again. Doing that on every save is too expensive at the rate a coding agent edits files, so in practice most tools batch it, which means there's a window, sometimes a long one, where the index is answering questions about a version of the code that's already gone.

The second cost is that you cannot check the answer.

An embedding search hands back a similarity score. A score is not evidence. There is no line you can point at and say *that* is why this file ranked, so when the answer is wrong there is nothing to debug, and when it is right you cannot tell whether it was right for a reason or by luck. That matters more than it sounds for a tool an agent calls dozens of times a session, because the agent is in the same position I am. Given a file with a number attached, it either trusts the number or spends turns re-verifying, and a good agent re-verifies. Given a file with "these three terms from your query are defined here, at these lines," it can judge on the spot and move on.

I want to be careful about what I am not claiming. I have not built an embedding index over these repositories and raced it against `find`, so I have no measurement saying one retrieves better than the other, and I am not going to imply one. The staleness window above is mechanical and I will defend it as stated. This second one is a design judgment about what an agent can act on, and it should be read as that.

<figure class="wide essay-fig ">
<div class="fig-plot">
<svg viewBox="0 0 920 340" role="img" aria-labelledby="r7t r7d">
<title id="r7t">A score you cannot check, and evidence you can</title>
<desc id="r7d">Two panels naming the same candidate file. On the left it arrives with a similarity score and nothing underneath it, so the only options are to trust the number or go and read the file. On the right the same file arrives with the query terms it declares and the lines they sit on, which can be judged without opening it.</desc>
<defs>
<filter id="r7" x="-6%" y="-6%" width="112%" height="112%">
<feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="2" seed="19" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G"/>
</filter>
</defs>
<g filter="url(#r7)">
<rect class="f-box" x="70" y="76" width="360" height="164" rx="8"/>
<path class="f-tick" d="M92 128 L408 128"/>
<rect class="f-box-ok" x="490" y="76" width="360" height="164" rx="8"/>
<path class="f-tick" d="M512 128 L828 128"/>
</g>
<text class="f-head" x="70" y="52" text-anchor="start">a score</text>
<text class="f-head" x="490" y="52" text-anchor="start">evidence</text>
<text class="f-key" x="92" y="114" text-anchor="start">src/auth/session.py</text>
<text class="f-key" x="408" y="114" text-anchor="end">0.83</text>
<text class="f-sub" x="92" y="160" text-anchor="start">nothing underneath it to inspect</text>
<text class="f-sub" x="92" y="188" text-anchor="start">trust the number, or open the file</text>
<text class="f-sub" x="92" y="216" text-anchor="start">wrong answers have nothing to debug</text>
<text class="f-key" x="512" y="114" text-anchor="start">src/auth/session.py</text>
<text class="f-key" x="828" y="114" text-anchor="end">3 of 3 terms</text>
<text class="f-sub" x="512" y="160" text-anchor="start">defines validate_token, line 41</text>
<text class="f-sub" x="512" y="188" text-anchor="start">defines refresh_session, line 88</text>
<text class="f-sub" x="512" y="216" text-anchor="start">imports session_store</text>
<text class="f-note" x="460" y="300" text-anchor="middle">both name the same file: only one of them can be checked without opening it</text>
</svg>
</div>
<figcaption>Not a claim about which one retrieves better, which I have not measured. A claim about what the agent receiving the answer can do with it: a score can only be trusted or re-verified, while the terms and lines behind a ranking can be judged in place.</figcaption>
</figure>

## What it uses instead

Files already declare their own identity: a filename, the segments of its path, the names it exports. Most of the time, the thing you're looking for is named close to what you'd call it, because someone wrote that name for exactly the reason you're now searching for it: so the next person reading the codebase could find it. coldstart ranks files by how many of your query terms they actually cover, using that declared identity plus a real repo-wide text search (backed by [ripgrep](https://github.com/BurntSushi/ripgrep), a fast plain-text search tool, where it's available; plain `git grep` where it isn't).

## Where coldstart is the worse tool

This is a worse tool than an embedding-based search for a genuinely fuzzy conceptual query, one where nothing in your vocabulary overlaps with anything in the file. I don't think that's a gap worth pretending away. If you want that kind of retrieval, point an embedding-based tool at the same repo. coldstart isn't trying to be the same thing done differently, it's trying to be exact where exactness is available, and honest about the rest. ([More on where that line actually falls.](/vs/vector-rag/))

## Why the exact half is the common half

The questions at the top of this post are not a flattering sample. They are what watching real sessions turns up: most navigation during an actual task isn't conceptual at all, it's literal, and the code already answers the literal kind definitively, in its names and its structure. Paying for an AI model call, plus the staleness window that comes with it, to answer a question the filenames already settle is a bad trade, made worse by the fact that it happens on almost every call, not occasionally.

There's a second reason that matters less philosophically and more practically: coldstart runs a background process that keeps its index current as you edit, patching just the changed files within a few seconds of a save. That only works cheaply because there's no AI model to call and no number-list to recompute. A patch is a few milliseconds of parsing per changed file. Re-running a model over every file that frequently, for every keystroke-adjacent save across a session, isn't something you'd want to pay for even if you could.

## The actual bet

The bet isn't that meaning doesn't matter. It's that most of what a coding agent asks while it's actually working is already answered by the structure the code declares about itself, and that answering those questions exactly, the same way every time, and for free, is worth more than answering a smaller number of genuinely fuzzy questions approximately. `find` and `gs` are built for the first kind of question. Where you need the second kind, that's a different tool, and coldstart isn't trying to replace it.
