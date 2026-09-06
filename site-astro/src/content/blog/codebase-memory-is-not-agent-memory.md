---
title: "Codebase memory is not agent memory"
description: "Two different problems get called memory in agent tooling right now. Conflating them gets you the wrong tool for the job you actually have."
lead: "Agent memory usually means remembering a person across conversations. Codebase memory means remembering a place. They sound like the same feature. They are not, and building one like the other is where it breaks."
keywords: "codebase memory, agent memory, persistent memory for coding agents, AI coding agent context, codebase notebook"
kicker: "Memory"
ogDescription: "Remembering a person and remembering a place are different problems. Codebase memory needs its own shape, not a copy of conversational memory."
publishDate: 2026-08-08
readingTime: "7 min"
tags: ["memory", "notebook", "codebase-memory"]
next: "why-coldstart-makes-zero-llm-calls"
---

Most things called "memory" for an AI agent are about a person. The agent talked to you last week, and it should remember your name, your preferences, the project you mentioned, the decision you already made so it doesn't ask again. That is a real problem and a reasonable one to solve with a store of facts about a user, retrieved by similarity when a new conversation starts.

I build a different kind of memory, and for a while I described it the same way, because the word was already sitting there. Borrowing the word turned out to mean borrowing an assumption with it, and I did not notice until the assumption was already shipped.

## The retrieval keys that never expired

The mistake was in the retrieval keys.

Every note in coldstart's notebook carries a handful of short alias strings: the words a later search should be able to find it by. I let them accumulate. Each time an agent updated a note it contributed whatever vocabulary it had been using, and nothing was ever removed.

That is the right behaviour for memory about a person. You told me in March that you prefer typed configs. That is still true in August unless you say otherwise, so a store of facts about you should union and hold, and forgetting would be the bug.

A note about a file is not like that, and the reason is specific. Much of the vocabulary an agent brings to a file arrives from an incident. Something was broken, the symptoms had names, and those names are what ended up written down. Once the bug is fixed, the symptom stops being a description of the file. It is a description of a week.

So the aliases silted up. Going back through my own notebook I found notes still keyed on phrases like "capture never fires" and "stop hook fires rarely": accurate accounts of a regression that had been fixed a while earlier, still attached to a note whose actual summary had moved on, still pulling that note to the surface whenever those words came up. Nothing was corrupt. Every one of those strings had been true when it was written. They had simply outlived the thing they described, and nothing in the design gave them any way to expire, because I had built them on the assumption that a fact once stated holds until it is contradicted.

The fix was to split the field in two. Names for stable things about the file accumulate, as they should. Words tied to whatever the note currently claims get replaced wholesale by the next write that changes the note's substance, so silence means "not carried forward" rather than "keep the old ones." That is a small change. The reason it was needed is the entire subject of this post: I had answered a codebase-memory question with a conversational-memory answer, and the two problems disagree about whether facts expire.

## What a codebase already remembers

A codebase does not forget anything. The function is still named what it's named. The import graph is still exactly what it is. If you want to know whether a file exports a symbol, you can go read the file, right now, and get the true answer. Code is its own perfect record of itself.

What's missing is a record of what an agent already worked out *about* the code, on someone else's turn, that isn't visible by reading the file itself. Which of three near-identical hook scripts is the one actually wired into the live config. Why a fix to one file's default value quietly broke a second file six commits later. Whether a function that looks dead is actually called through a framework convention no import statement shows.

None of that is a fact about the agent. It's a fact about the place, and it should attach to the file rather than the user, disappearing the moment the file it describes changes underneath it.

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
<figcaption>A preference has no ground truth to check against, so it just holds until you say otherwise. A note about code sits next to the file it describes, and that's what lets the system catch the note going stale instead of quietly acting on it, not extra ceremony.</figcaption>
</figure>

## Who is qualified to write one

One more difference falls out of the same root. For a person, the agent is the only witness: it heard what you said, and that is the end of it. For code the ground truth is on disk and anyone can re-read it, which means the note worth having is precisely the one that *isn't* readable off the file, and the only party holding that is the agent that just spent the turns working it out. That argument has its own post, [made at length](/blog/notes-should-be-written-by-whoever-read-the-code/). The short form: a codebase note is a byproduct of the task, not a later extraction pass over a log.

## Remembering a person, remembering a place

I stopped calling this "agent memory" because the name imports the wrong answers to questions it does not look like it is answering.

A memory about a person is a record of what was said, and saying it is what made it true. There is nothing else to check it against, so it holds until it is restated. A note about code is a record of what was *found*, and the thing that made it true is still sitting on disk, changing, without telling you. That single difference is what forces the address, the freshness stamp, the expiry, and the split between a name and a symptom. None of it is extra ceremony. It is what remembering a place costs when the place can move.

Every design question I had got easier the moment I stopped answering it from the other problem.
