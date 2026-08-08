---
title: "Codebase memory is not agent memory"
description: "Two different problems get called memory in agent tooling right now. Conflating them gets you the wrong tool for the job you actually have."
lead: "Agent memory usually means remembering a person across conversations. Codebase memory means remembering a place. They sound like the same feature. They are not, and building one like the other is where it breaks."
keywords: "codebase memory, agent memory, persistent memory for coding agents, AI coding agent context, codebase notebook"
kicker: "Memory"
ogDescription: "Remembering a person and remembering a place are different problems. Codebase memory needs its own shape, not a copy of conversational memory."
publishDate: 2026-08-08
readingTime: "6 min"
tags: ["memory", "notebook", "codebase-memory"]
next: "why-coldstart-makes-zero-llm-calls"
---

Most things called "memory" for an AI agent are about a person. The agent talked to you last week, and it should remember your name, your preferences, the project you mentioned, the decision you already made so it doesn't ask again. That is a real problem and a reasonable one to solve with a store of facts about a user, retrieved by similarity when a new conversation starts.

I build a different kind of memory, and for a while I described it the same way, because the word was already sitting there. It took getting the design wrong once to notice it is not the same problem at all.

## What a codebase already remembers

A codebase does not forget anything. The function is still named what it's named. The import graph is still exactly what it is. If you want to know whether a file exports a symbol, you can go read the file, right now, and get the true answer. Code is its own perfect record of itself.

What is missing is not a record of the code. It's a record of what an agent already worked out *about* the code, on someone else's turn, that isn't visible by reading the file itself. Which of three near-identical hook scripts is the one actually wired into the live config. Why a fix to one file's default value quietly broke a second file six commits later. Whether a function that looks dead is actually called through a framework convention no import statement shows.

None of that is a fact about the agent. It's a fact about the place. It should attach to the file, not to the user, and it should be gone the moment the file it describes changes underneath it.

## Why the storage shape has to differ

A memory about a person is mostly stable and mostly small. Your name doesn't change turn to turn. A preference, once stated, holds until you say otherwise. Retrieval by rough similarity is fine because there is no ground truth to check a fact about you against beyond you saying it again.

A note about code has a ground truth sitting right next to it: the file. That changes the requirements completely. A note that says "this function validates the session token" is either still true of the current bytes of that file or it isn't, and there is a mechanical way to check which. A stale codebase note is worse than no note, because an agent will act on it as if the code still matches. So the note needs an address (a file, often a symbol inside it) and it needs a way to know it has gone stale, which a fact about a person's preferences never needs.

That's the part conversational memory tooling doesn't have to solve and codebase memory can't skip. In practice it means stamping each note against the exact state of the file it was verified against, so a later read can tell in one comparison whether the file has moved on without it. A note that can't tell you it might be wrong is a liability dressed as a convenience.

<figure class="wide essay-fig ">
<div class="fig-plot">
<svg viewBox="0 0 920 340" role="img" aria-labelledby="r5t r5d">
<title id="r5t">Two different things called memory</title>
<desc id="r5d">Top row: a preference about a person, held until restated, with no file beside it to check against. Bottom row: a note about code, stamped against the file it describes, so it can be flagged stale the moment the file moves.</desc>
<defs>
<filter id="r5" x="-6%" y="-6%" width="112%" height="112%">
<feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="2" seed="13" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G"/>
</filter>
</defs>
<g filter="url(#r5)">
<rect class="f-box" x="70" y="74" width="260" height="62" rx="6"/>
<rect class="f-box-ok" x="400" y="74" width="280" height="62" rx="6"/>
<path class="f-pen" d="M340 105 L390 105"/>
<path class="f-pen" d="M379 99 L390 105 M379 111 L390 105"/>
<rect class="f-box" x="70" y="244" width="240" height="62" rx="6"/>
<rect class="f-box" x="380" y="244" width="170" height="62" rx="6"/>
<path class="f-pen" d="M320 275 L370 275"/>
<path class="f-pen" d="M359 269 L370 275 M359 281 L370 275"/>
<path class="f-tick" d="M560 275 L640 275"/>
<rect class="f-box" x="650" y="244" width="200" height="62" rx="6"/>
<rect class="f-mark" x="646" y="240" width="208" height="70" rx="8"/>
</g>
<text class="f-head" x="70" y="50" text-anchor="start">memory about a person</text>
<text class="f-key" x="200" y="100" text-anchor="middle">preference stated once</text>
<text class="f-key" x="540" y="100" text-anchor="middle">held until you say otherwise</text>
<text class="f-sub" x="70" y="168" text-anchor="start">no file sits next to it to check against</text>
<text class="f-head" x="70" y="220" text-anchor="start">memory about code</text>
<text class="f-key" x="190" y="270" text-anchor="middle">note: validates session token</text>
<text class="f-key" x="465" y="270" text-anchor="middle">the file, right now</text>
<text class="f-sub" x="600" y="230" text-anchor="middle">stamped + checked on read</text>
<text class="f-note" x="750" y="270" text-anchor="middle">flagged stale</text>
<text class="f-sub" x="70" y="330" text-anchor="start">a note that can tell you it might be wrong beats one that can't</text>
</svg>
</div>
<figcaption>A preference has no ground truth to check against, so it just holds until you say otherwise. A note about code sits next to the file it describes, and that's not extra ceremony — it's what lets the system catch the note going stale instead of quietly acting on it.</figcaption>
</figure>

## Where the notes actually come from

The other difference is who's qualified to write the note. For a person, the agent is the only witness. For code, the agent that just spent real turns tracing a call path, reading three files to find where a value actually gets set, running the failing case down to the line, is also the only witness that has the full context right now. A note written after the fact, by summarizing a transcript, is not the same thing. It's a paraphrase of a paraphrase.

So the natural place to write a codebase note is the moment the work happens, by the agent doing the work, not as a separate memory-extraction pass over a log later. The note is a byproduct of the task, not a second task.

## Naming the category

I stopped calling this "agent memory" because it invites the wrong comparison. It's not a bigger or smarter version of remembering a user's preferences. It's memory for a codebase specifically: address it to the code, expire it against the code, and let the agent that did the reading be the one who writes it down. Once you name it as its own thing, the design questions get a lot easier to answer, because you stop importing answers from a problem that isn't the one in front of you.
