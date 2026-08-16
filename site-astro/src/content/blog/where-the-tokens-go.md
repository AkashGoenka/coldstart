---
title: "Where the tokens go in an agent session"
description: "Most of what an agent session costs is not the answer it produced. It is the same context, re-sent on every turn. How to decompose your own transcript and find the one lever that matters."
lead: "A long session bills for something. The instinct is to blame the tool that returned a big block of output. That instinct is almost always wrong, and the arithmetic that explains why also tells you the only thing worth optimising."
keywords: "agent token cost, Claude Code token usage, prompt caching, cache_read, agent session cost, coding agent context window"
kicker: "Cost"
ogDescription: "Most of what a session costs is not the answer. It is the same context, re-sent on every turn."
publishDate: 2026-07-25
readingTime: "7 min"
tags: ["cost", "context-windows", "prompt-caching"]
next: "an-index-cannot-answer-twice"
---

I spent a while building tooling for coding agents while assuming the thing I should optimise was output size. Return fewer lines. Trim the file listing. Compress the search result. It seemed obvious. The tool prints text into the conversation, the conversation costs money, so smaller output costs less.

Then I actually decomposed a session, and the picture was not the one I had in my head.

## What a turn actually bills for

A chat with a model is stateless underneath, meaning the model itself has no memory between calls; it doesn't remember the previous turn on its own. Every time the agent takes an action, the entire conversation so far is sent again: the system prompt, the tool definitions, every file that was read, every command that was run, every result that came back.

Providers soften this with prompt caching. The unchanged prefix of the conversation gets cached, and re-sending it is much cheaper than sending it fresh. Cheaper is not free. You are still billed for every cached token, on every single turn, for the rest of the session.

So a turn costs roughly the size of everything resident in the conversation at that moment. Not the size of what just happened. The size of everything that has happened.

Which gives you a rough model of a whole session:

```
session cost  ≈  number of turns  ×  average resident context
```

Two terms. Worth asking which one you can actually move.

## The resident context only grows

Look at what sits in that second term.

- The harness system prompt. Fixed, and you do not control it.
- Your project instruction files, loaded at the start.
- The schema for every tool the agent has available.
- Every file read so far, in full.
- Every command and its output, in full.

Only the last two grow during the session, and they grow in one direction. Nothing leaves the conversation. Reading a file isn't a one-time cost of that file: it's a subscription, you pay for those lines again on every remaining turn.

The tool schemas deserve a specific mention, because this one surprised me. A tool definition isn't billed once when you install it: it's part of the prompt, so it's billed on every turn like everything else. Connect a server that exposes a dozen richly documented operations and you have added rent to the whole session, paid whether the agent calls any of them or not. A tool surface isn't a menu you browse for free. It's a standing charge.

The practical consequence is that the resident term is mostly not yours to shrink. You can be careful about what gets read. You can keep your tool surface small. Beyond that, it is a floor that rises.

## Output is a rounding error

Here is the part that killed my original assumption.

What the model writes is a small fraction of what a session bills. Not a modest fraction. Small enough that halving it changes almost nothing. The reason is structural: output is generated once, then it becomes part of the conversation and is re-billed as cached context on every subsequent turn, at a much lower rate. The single largest share of a long session is re-reading context that was already established.

So the effort I put into trimming a tool's output was aimed at the term that mattered least. A tool that prints twenty extra lines has added twenty lines to the resident context. Real, but marginal.

A tool that causes one extra turn has re-billed the entire conversation.

<figure class="wide essay-fig ">
<div class="fig-plot">
<svg viewBox="0 0 920 410" role="img" aria-labelledby="r1t r1d">
<title id="r1t">What a session bills for, turn by turn</title>
<desc id="r1d">Eight columns, one per turn. Each is the whole conversation resident at that moment and each is billed in full. A fixed base of system prompt and tool schemas repeats unchanged. Above it, everything read so far accumulates and never shrinks. The model output for that turn is the thin band on top.</desc>
<defs>
<filter id="r1" x="-6%" y="-6%" width="112%" height="112%">
<feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="2" seed="3" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G"/>
</filter>
</defs>
<g filter="url(#r1)">
<rect class="f-base" x="78" y="296" width="58" height="44" rx="6"/>
<rect class="f-out" x="78" y="288" width="58" height="8" rx="6"/>
<rect class="f-base" x="174" y="296" width="58" height="44" rx="6"/>
<rect class="f-grow" x="174" y="270" width="58" height="26" rx="6"/>
<rect class="f-out" x="174" y="262" width="58" height="8" rx="6"/>
<rect class="f-base" x="270" y="296" width="58" height="44" rx="6"/>
<rect class="f-grow" x="270" y="244" width="58" height="52" rx="6"/>
<rect class="f-out" x="270" y="236" width="58" height="8" rx="6"/>
<rect class="f-base" x="366" y="296" width="58" height="44" rx="6"/>
<rect class="f-grow" x="366" y="218" width="58" height="78" rx="6"/>
<rect class="f-out" x="366" y="210" width="58" height="8" rx="6"/>
<rect class="f-base" x="462" y="296" width="58" height="44" rx="6"/>
<rect class="f-grow" x="462" y="192" width="58" height="104" rx="6"/>
<rect class="f-out" x="462" y="184" width="58" height="8" rx="6"/>
<rect class="f-base" x="558" y="296" width="58" height="44" rx="6"/>
<rect class="f-grow" x="558" y="166" width="58" height="130" rx="6"/>
<rect class="f-out" x="558" y="158" width="58" height="8" rx="6"/>
<rect class="f-base" x="654" y="296" width="58" height="44" rx="6"/>
<rect class="f-grow" x="654" y="140" width="58" height="156" rx="6"/>
<rect class="f-out" x="654" y="132" width="58" height="8" rx="6"/>
<rect class="f-base" x="750" y="296" width="58" height="44" rx="6"/>
<rect class="f-grow" x="750" y="114" width="58" height="182" rx="6"/>
<rect class="f-out" x="750" y="106" width="58" height="8" rx="6"/>
<path class="f-axis" d="M60 340 L860 340"/>
<rect class="f-mark" x="742" y="98" width="74" height="250" rx="6"/>
</g>
<g filter="url(#r1)"><rect class="f-base" x="78" y="16" width="13" height="13" rx="3"/></g>
<text class="f-key" x="99" y="27" text-anchor="start">fixed: system prompt + tool schemas</text>
<g filter="url(#r1)"><rect class="f-grow" x="372" y="16" width="13" height="13" rx="3"/></g>
<text class="f-key" x="393" y="27" text-anchor="start">everything read or run so far</text>
<g filter="url(#r1)"><rect class="f-out" x="666" y="16" width="13" height="13" rx="3"/></g>
<text class="f-key" x="687" y="27" text-anchor="start">what the model wrote this turn</text>
<text class="f-lab" x="107" y="360" text-anchor="middle">1</text>
<text class="f-lab" x="203" y="360" text-anchor="middle">2</text>
<text class="f-lab" x="299" y="360" text-anchor="middle">3</text>
<text class="f-lab" x="395" y="360" text-anchor="middle">4</text>
<text class="f-lab" x="491" y="360" text-anchor="middle">5</text>
<text class="f-lab" x="587" y="360" text-anchor="middle">6</text>
<text class="f-lab" x="683" y="360" text-anchor="middle">7</text>
<text class="f-lab" x="779" y="360" text-anchor="middle">8</text>
<text class="f-lab" x="60" y="384" text-anchor="start">turn →</text>
<text class="f-note" x="808" y="398" text-anchor="end">one more turn re-bills every layer below it</text>
</svg>
</div>
<figcaption>A turn is billed for everything resident at that moment, not for what just happened. The base repeats unchanged all session. The middle only grows, because nothing leaves a conversation. What the model actually wrote is the band on top.</figcaption>
</figure>

## Turns are the lever

If the resident context mostly cannot shrink, and output barely counts, then the number of turns is what you have left. And unlike the other two, it responds to design.

This reframes what a good tool for an agent looks like. The question isn't how much a tool printed: it's whether the agent had to ask again.

A search that returns forty file paths with no way to tell which matters causes the agent to open several of them to find out. Each open is a turn, and each opened file joins the resident context permanently. The search looked cheap. It was not. It was the most expensive thing in the sequence, because of what it made happen next.

A search that returns eight paths, says which ones define the thing you asked about rather than merely mentioning it, and shows enough of the relevant lines to judge without opening the file, can end the question in one turn. It printed more. It cost less.

Same logic in the other direction. Ten small precise calls are worse than two calls that each carry more. Batch what you can. Answer the follow-up before it is asked.

## Measuring your own

None of this needs to be taken on faith. If you use a harness (the program running the agent loop, like Claude Code or Cursor) that writes session transcripts to disk, the numbers are already there.

Each assistant message carries a usage record with separate counts for fresh input, cache reads, cache writes, and output. The total billed for that turn is the sum of all four. Two things to be careful about. Dedupe by message id first, because a streamed message can appear more than once and double counting will flatter or wreck your result. And group by turn, so you can watch the resident context climb rather than seeing one aggregate.

Then plot the per-turn total across the session. You are looking for two things: how fast the line rises, which tells you what is accumulating, and how many turns there are, which is the thing you can act on. Compare the same task done two ways and count turns, not tokens. Turns are the honest metric because tokens follow from them.

I would suggest doing this on your own sessions rather than trusting anyone's published figures, mine included. The shape holds across harnesses. The exact proportions depend on your system prompt, your instruction files, how many tools you have connected, and how large the files in your repository are. A codebase with long files behaves differently from one with short ones.

## What I changed

The measurement changed what I build. I stopped trying to make output smaller and started trying to make answers final.

In practice that meant a few things. Ranked results instead of a list, so the agent does not open five files to find the one. Enough of the matching lines inline that the file often does not need to be opened at all. Relationships between files returned alongside the file, because "who calls this" being a second question is a second turn. And a deliberately small tool surface, since every operation I expose is charged on every turn of every session whether it earns that or not.

That last one is why coldstart is two commands rather than the larger set I started with. `find` locates the files for a concept and ranks them by evidence. `gs` takes one file and returns its shape along with who uses it. There is no third operation, and cutting the others was not a simplification for its own sake. Each one was rent.

The general form of the lesson is short. Work out the cost model of the thing you are building for before you optimise anything, because the obvious target and the real one are often not the same, and in this case they are not even close.
