---
title: "Why most token savings tools lie"
description: "Most published token-savings percentages measure a compressed call, not a smaller bill. What it actually takes to measure a whole session, and the two real numbers that came out of doing it that way."
lead: "A token-savings number is only true if it's measured across the whole session. Shrink what one command returns and the agent can just ask for more of it. That gap is where most savings claims you'll see fall apart, and it's the first thing I had to get right before I trusted any number of my own."
keywords: "AI coding agent benchmark, token savings, prompt caching cost, coding agent evaluation methodology"
kicker: "Cost"
ogDescription: "A smaller command result and a smaller bill are not the same claim. The mechanism that breaks the shortcut, and the two real numbers I got by measuring the whole session instead."
publishDate: 2026-08-08
readingTime: "10 min"
tags: ["benchmark", "cost", "methodology"]
next: "how-your-own-benchmark-lies-to-you-first"
---

There's a temptation with any benchmark: run it once, get a number that looks good, put it on the site. I did that once with coldstart's own numbers, caught it before it shipped, and the fix taught me more about what I was actually measuring than the number itself did.

## The shortcut that breaks

Most token-savings numbers you'll see for agent tooling are measuring the wrong thing, and the reason is mechanical, not a matter of anyone rounding generously. I covered the mechanism in [Where the tokens go in an agent session](/blog/where-the-tokens-go/): on a real trace I decomposed turn by turn, about 90% of total tokens were cache reads, the accumulated conversation getting re-billed on every single turn. Coldstart's own output, the part a tool can shrink directly, was roughly 2% of the bill.

That ratio is why compressing an individual call doesn't tell you what you think it tells you. If a tool takes a grep result, a directory listing, or a batch of retrieved context and returns a smaller version of it, that's a real, measurable reduction of one artifact. It says nothing about the session, because it doesn't touch turn count, and turn count is what the other 98% is riding on. Worse, it can go the other way: give an agent cheaper access to more context and it often just asks for more of it, or issues more calls to compensate for a thinner answer, and the total goes up even though the one number that got measured, the size of a single response, went down.

So the only claim worth calling a savings number is total tokens (or dollars) across an entire session, one full task done with the tool against the same task done without it, counted from the session's own usage records afterward. Anything narrower, a single call's output, a compressed context batch, a shorter prompt, is a real measurement of something, just not of that.

## When smaller costs more

There's a version of this that doesn't just measure the wrong thing, it can point in the wrong direction entirely, and the mechanism is worth understanding because it isn't obvious from outside.

Prompt caching is what makes a long agent session affordable at all, and every provider that offers it works the same way underneath: the cache is keyed to an exact prefix, the literal, unchanged beginning of the conversation. Send that same prefix again on the next turn and you pay a fraction of the price for it. Change one byte anywhere before the cache boundary, summarize an earlier exchange, drop a tool call judged no longer relevant, reorder something to save space, and the match breaks from that point forward. Every token after the edit gets billed fresh on the very next turn, at full price, regardless of how much smaller the edited version is.

That means a tool can genuinely shrink what's sitting in the context window and still raise the bill for that session, because it converted tokens that were about to be cheap cache reads back into expensive cache writes. A dashboard reading "40% smaller context" isn't lying about the context. It's just not the same claim as "40% cheaper session," and on the same transcript, the two numbers can point in opposite directions.

The ratio this rides on is large enough to make the bet a bad one by default. On a real session I decomposed for [the tokens post](/blog/where-the-tokens-go/), the fixed base alone, system prompt plus tool schemas, sat around 25,000 tokens, resident and unchanged on every turn. Across 15 turns, re-reading that one unchanged block was roughly half the entire session's bill, and every one of those re-reads was a cheap cache hit, precisely because nothing before that point in the conversation ever moved. Touch anything earlier in the transcript to save space and you're betting against that ratio, not for it: you're risking the cheap half of the bill to shrink a number that was never the expensive part.

So the question worth asking of anything that compresses or rewrites context already in the conversation, as opposed to a single new call's output, is whether its savings number survives being measured after the edit, from the resulting usage record, on the same real task, rather than compared against the size of the thing it rewrote. If the number only holds at the instant the edit is applied, it isn't a session cost number yet. It's a description of the edit.

## What I actually measured

That's the standard I held coldstart's own numbers to: turns and total tokens across a whole session, coldstart wired in against a no-tool baseline doing the same task with plain file reads, greps, and directory listings. Each arm is a real agent session against a real repository, tokens read off that session's own usage records, not estimated and not summed from a printed total. Both arms ran the same fixed list of queries, once each, no retries.

I ran this on two real open-source applications rather than a synthetic benchmark repo, because a repo built to be benchmarked tends to have suspiciously clean naming and structure that a real codebase doesn't. Arches is a Python and Django application, 27 queries. JMRI is a Java application, considerably more verbose per file and with a heavier build surface, 25 queries. Both query lists are navigation questions representative of what an agent actually asks while working a real task in that codebase: where's the thing that handles this, who calls this function, what does this error trace back to. Recall was scored against a fixed, pre-written list of the files a correct answer to each query has to include, decided before either arm ran, not reconstructed afterward from whichever arm did better.

## The number that was too good

The Arches sweep, 27 queries, came out to a 64% reduction in tokens against the no-tool baseline, with recall two points better on top of that, because the baseline sometimes ran out of turns before it found the right file at all and gave a worse answer, not just a slower one.

The JMRI sweep, 25 queries, first came out at 39%. That's a strong number and I almost left it there. What made me distrust it was noticing the baseline runs in that sweep were taking noticeably longer in wall-clock time than the coldstart runs, more than the token counts alone explained. The machine running the sweep was also doing other work at the time, and the baseline's heavier reliance on repeated full-file reads and directory walks made it more sensitive to that contention than coldstart's smaller, targeted calls were. The savings number wasn't purely measuring the tool. It was partly measuring a machine under uneven load.

I reran the JMRI sweep in isolation, no other processes competing for CPU. The real number is 31%, recall at parity rather than better. Fifteen points lower than the first run.

<figure class="wide essay-fig ">
<div class="fig-plot">
<svg viewBox="0 0 920 380" role="img" aria-labelledby="r8t r8d">
<title id="r8t">The number that was too good, and the one that replaced it</title>
<desc id="r8d">Three bars. Arches at sixty-four percent fewer tokens. JMRI's first run at thirty-nine percent, flagged as measured on a machine under contention. JMRI's isolated rerun at thirty-one percent, fifteen points lower and the number that actually gets published.</desc>
<defs>
<filter id="r8" x="-6%" y="-6%" width="112%" height="112%">
<feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="2" seed="23" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G"/>
</filter>
</defs>
<g filter="url(#r8)">
<path class="f-axis" d="M80 320 L860 320"/>
<rect class="f-out" x="110" y="110" width="130" height="210" rx="6"/>
<rect class="f-grow" x="390" y="192" width="130" height="128" rx="6"/>
<rect class="f-mark" x="386" y="188" width="138" height="136" rx="8"/>
<rect class="f-out" x="670" y="218" width="130" height="102" rx="6"/>
<path class="f-pen" d="M520 188 C 580 145 610 145 670 213"/>
<path class="f-pen" d="M659 208 L670 213 L664 224"/>
</g>
<text class="f-head" x="80" y="55" text-anchor="start">measured whole-session savings</text>
<text class="f-sub" x="80" y="76" text-anchor="start">percent fewer tokens than the no-tool baseline</text>
<text class="f-note" x="175" y="98" text-anchor="middle">64%</text>
<text class="f-sub" x="455" y="180" text-anchor="middle">39%, provisional</text>
<text class="f-note" x="735" y="206" text-anchor="middle">31%</text>
<text class="f-key" x="595" y="135" text-anchor="middle">reran in isolation — 15 points lower</text>
<text class="f-lab" x="175" y="344" text-anchor="middle">Arches — 27 queries</text>
<text class="f-lab" x="455" y="344" text-anchor="middle">JMRI — first run</text>
<text class="f-sub" x="455" y="362" text-anchor="middle">machine under contention</text>
<text class="f-lab" x="735" y="344" text-anchor="middle">JMRI — isolated rerun</text>
</svg>
</div>
<figcaption>The first JMRI number looked real and wasn't quite: the baseline was running on a machine under contention, inflating the gap. Isolating the rerun brought it down fifteen points, to the number that actually gets published.</figcaption>
</figure>

## Why the correction is the point

It would have been easy to keep the first number. Nobody auditing a percentage on a website reruns your benchmark. But a number you can't explain how you got is not a number, it's a claim, and the difference matters most exactly when nobody's checking. The methodology has to be something a skeptical reader could redo: real repository, fixed query list, controlled machine, counted from the actual transcript's usage records rather than eyeballed from a printed summary, same as the process in the tokens post.

The gap between the two real numbers is informative in its own right. Arches at 64% and JMRI at 31% are not the same win, and averaging them into one blended figure would have erased the reason they differ. Java's verbosity and build tooling change what a single turn costs in that codebase, which changes how much a tool that reduces turns can save. A single number implies the saving is a property of the tool. Two numbers, from two different codebases, show it's a property of the tool interacting with the codebase, which is the truer and less flattering thing to say.

Both numbers also stayed inside the standard from the top of this post: whole session, both arms, same task, counted from the transcript. A tool that only ever shows you a percentage without saying what it was measured against, whole session or single call, isn't being cagey about a detail. It's not stating the thing that would let you check it.

## What this number doesn't cover

Both sweeps measure navigation: an agent asking where something lives, who calls it, what it depends on. Coldstart also keeps a notebook, and after a real task it writes down what it worked out, which costs its own tokens on top of whatever the navigation calls cost. That write is not in either number above, because a pure navigation query doesn't trigger it, and I haven't yet run a sweep built to isolate what a full task, edits and note-writing included, costs with coldstart against the same task without it. I'd rather say that plainly than fold in a number from a different kind of run just to make this one sound more complete. When that sweep exists, it gets its own post, not a quiet edit to this one.

Same caveat on repeats: each arm here ran once per query, not several times averaged. Token counts on a coding agent vary run to run even with nothing else changed, so a single run tells you what happened, not the full spread of what could happen. Wider than that, I haven't measured.

## The test that actually catches it

None of this needs a benchmark to check. Take any published savings number and ask two questions. First, is it measured across the whole session, from the final usage record, or against the size of one call, one context batch, or one edit? Second, if it involves rewriting or summarizing context that was already in the conversation, does the number still hold after accounting for the cache writes that rewrite forces on every token that comes after it? A number that survives both is measuring a session. A number that only survives the first is measuring a call. A number that fails the second was measuring the wrong direction the whole time.

## The two numbers, stated plainly

Arches: 27-query sweep, 64% fewer tokens than the no-tool baseline, recall two points better. JMRI: 25-query sweep, 31% fewer tokens, recall at parity. Both are navigation-only, one run per arm, measured the same way, on real applications, against a baseline doing the same task without coldstart. If you run this on your own codebase and get a different number, that's expected, not a contradiction, because the number was never a property of the tool alone.
