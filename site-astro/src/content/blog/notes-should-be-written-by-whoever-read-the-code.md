---
title: "Notes about code should be written by whoever read the code"
description: "Why codebase notes for AI coding agents should be written by the agent that did the work, not reconstructed later from a transcript."
keywords: "AI coding agent notes, codebase notebook, agent memory, transcript summarization, durable investigations, coldstart"
kicker: "Codebase notes"
ogDescription: "A transcript is not the same thing as context. The agent that did the work is usually the only one qualified to write down what was learned."
lead: "I maintain a tool that keeps notes about a codebase. An agent does a task, and at the end it writes down what it worked out. There is an easier way to build this. I chose not to take it."
publishDate: 2026-07-25
readingTime: "6 min"
wordCount: 1086
tags: ["notebook", "agent-memory", "capture"]
next: "codebase-memory-is-not-agent-memory"
---

I maintain a tool that keeps notes about a codebase. An agent does a task, and at the end it writes down what it worked out. There is an easier way to build this. I chose not to take it.

The easier design is a background job. Coding agents already leave transcripts behind, so a tool can wake up later, read the finished sessions, decide whether anything durable happened, and write notes from the log.

That design has obvious advantages. It never interrupts you. It can backfill old sessions. You can improve the summarizer later and run it again over the whole archive. I understand the appeal. I still think it produces worse notes, for a reason that has nothing to do with how clever the summarizer is.

## What a transcript actually contains

Say the agent opens a 400-line file, reads it, and says: "I see the problem. The retry loop never resets the counter, so the second failure trips the limit immediately."

The transcript now holds that sentence and a record that a file got read. It does not hold the file in the same way the agent held it while working. The agent had 400 lines in front of it when it reached the conclusion. The transcript has a short sentence about them.

A background job reading this later has two choices. It can write a note from the sentence, which means the note says roughly what the sentence said and nothing more. Or it can go open the file and work it out again.

<figure class="wide essay-fig">
<div class="fig-plot">
<svg viewBox="0 0 920 340" role="img" aria-labelledby="r4t r4d">
<title id="r4t">What the writer of a note can still see, over time</title>
<desc id="r4d">One timeline. While the session runs, everything the agent opened is in context, drawn as a tall band. When the session ends the band falls to a sliver, because the context is discarded and only the transcript remains. Two pins mark where a note could be written: one before the drop with the files still in hand, one after it with only a sentence.</desc>
<defs>
<filter id="r4" x="-6%" y="-6%" width="112%" height="112%">
<feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="2" seed="5" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G"/>
</filter>
</defs>
<g filter="url(#r4)">
<path class="f-area-a" d="M100 280 L100 90 L520 90 L520 266 L840 266 L840 280 Z"/>
<path class="f-axis" d="M86 280 L856 280"/>
<path class="f-tick" d="M520 62 L520 300"/>
<path class="f-pen" d="M470 86 L470 56"/>
<circle class="f-pin" cx="470" cy="90" r="6"/>
<path class="f-pen" d="M700 262 L700 214"/>
<circle class="f-pin" cx="700" cy="266" r="6"/>
</g>
<text class="f-head" x="64" y="185" transform="rotate(-90 64 185)" text-anchor="middle">what the writer can still see</text>
<text class="f-note" x="470" y="44" text-anchor="middle">the agent that read the code writes here</text>
<text class="f-key" x="300" y="192" text-anchor="middle">every file it opened, still in context</text>
<text class="f-note" x="700" y="204" text-anchor="middle">a background job writes here, later</text>
<text class="f-key" x="770" y="304" text-anchor="middle">one sentence that survived into the transcript</text>
<text class="f-lab" x="520" y="316" text-anchor="middle">the session ends, its context is discarded</text>
<text class="f-lab" x="86" y="316">time →</text>
</svg>
</div>
<figcaption>The same session either way. What changes is when the note gets written: before the drop, by the agent still holding the file, or after it, from the one sentence that made it into the log.</figcaption>
</figure>

## Re-reading is a different job than remembering

If the background job opens the file, it is no longer summarizing the session. It is doing a fresh investigation, using the transcript as a hint about where to look.

That investigation is missing the thing that made the original investigation useful: the live task. The first agent had a failing test, a user asking for something specific, a trail of wrong guesses, and a reason to care about one part of the file rather than another. The later job has a file and a sentence.

So the note it writes tends to become a description of the code. That is the least interesting kind of note. Anyone can get that by reading the code. The thing worth preserving is usually what was not obvious from reading.

## The useful part is the correction

The notes worth keeping are often about a wrong belief that got corrected: the fix that looked right and was not, the two files that had to change together for a reason hidden between them, the thing that looked like dead code and turned out to be load-bearing.

That kind of note only exists relative to the path the investigation took. A transcript records the conclusion. It records the wrong belief only if somebody happened to say it out loud, and most of the time nobody does. You do not narrate every assumption. You act on it, discover it was wrong, and quietly stop believing it.

The surprise is the part that often does not survive into the log. The surprise is also the part I most want written down.

## Long sessions make this worse

You might expect a longer session to leave a better transcript. More turns, more detail, more material for the summarizer.

In practice, long sessions get compacted. The tool notices the conversation is running out of room, summarizes the earlier part, and drops the original turns. The detail is gone from the log even though the agent may still be operating from what it learned.

That means transcript-based capture loses the most detail on the sessions that probably mattered most: the long ones, where the hard problem was solved.

## What I do instead

The capture runs at the end of a turn, inside the session that just happened.

It does not read the transcript to find out what was learned. It reads it to find out which files were touched, and how: opened, edited, looked up. That is a mechanical question, and a log answers it well enough.

Then it hands that list back to the agent that just did the work and asks it to write the notes. The files are still in context. The wrong assumption is still recent. Nothing has to be reconstructed.

The rule I settled on is short: if writing the note needs a read you have not already done, do not write the note. An agent that has to go look something up in order to write a note isn't remembering, it's guessing, and a guess written into a file that another agent will trust later is worse than no file at all.

## Freshness is what makes the note usable

Because the note is written by the agent that read the files, the tool knows which files it came from. It records a content hash for each one, a fingerprint of the file's exact contents at that moment, so any later change to the file produces a different fingerprint.

Later, when the note is shown, one of two things is true. Either the file has not changed since the note was written, and the note can be trusted without opening the file again. Or the file has changed, and the note is shown with a warning naming the file to check.

That is what "self-updating" means here. Not that a model rewrites prose on a schedule, but that the note knows when the ground moved under it.

## What it costs

This design is not free.

It interrupts sometimes. Not often, and not after every session, but it does ask for a minute of writing when there is enough evidence that something durable happened. A background job would never interrupt.

It also does not know anything on day one. There is no bulk import of your git history, no instant knowledge base from old transcripts. It learns where work actually happens, which means it takes time to become useful.

I took those costs because fewer notes that are true seem more valuable than a large pile of notes reconstructed from partial context.

## How coldstart fits into this

coldstart's notebook follows this design. Notes are written by agents after real work, stored in the repo, anchored to concrete files and symbols, and surfaced later only as reference data. If the evidence changed, the note says so.

The point isn't to build a perfect memory: it's to stop pretending that a transcript is the same thing as the working context that produced it.
