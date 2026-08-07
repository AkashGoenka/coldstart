---
title: "What the numbers actually say"
description: "The honest path to two real token-savings numbers on real repositories, including the one that came out too good and had to be corrected down."
lead: "I wanted a headline number for how much coldstart saves. Getting one that would hold up meant throwing away the first one I got, because it was too good, and the reason it was too good had nothing to do with the tool."
keywords: "AI coding agent benchmark, token savings, prompt caching cost, coding agent evaluation methodology"
kicker: "Cost"
ogDescription: "One sweep produced a 39% savings number that turned out to be a measurement artifact. The corrected number is 31%, and the correction is the part worth publishing."
publishDate: 2026-08-10
readingTime: "6 min"
tags: ["benchmark", "cost", "methodology"]
next: "what-a-graph-cannot-see"
---

There's a temptation with any benchmark: run it once, get a number that looks good, put it on the site. I did that once with coldstart's own numbers, caught it before it shipped, and the fix taught me more about what I was actually measuring than the number itself did.

## What I actually measured

The question isn't "does coldstart make responses shorter." I covered why that's the wrong question in [Where the tokens go in an agent session](/blog/where-the-tokens-go/): a session's cost tracks the number of turns, not the size of any one output, because every turn re-bills the whole conversation so far. So the right comparison is turns and total tokens across a whole task, coldstart wired in against a no-tool baseline doing the same task with plain file reads, greps, and directory listings.

I ran this on two real open-source applications rather than a synthetic benchmark repo, because a repo built to be benchmarked tends to have suspiciously clean naming and structure that a real codebase doesn't. Arches is a Python and Django application. JMRI is a Java application, considerably more verbose per file and with a heavier build surface. Both sweeps used a fixed set of navigation queries representative of what an agent actually asks while working a real task in that codebase: where's the thing that handles this, who calls this function, what does this error trace back to.

## The number that was too good

The Arches sweep, 27 queries, came out to a 64% reduction in tokens against the no-tool baseline, with recall two points better on top of that, because the baseline sometimes ran out of turns before it found the right file at all and gave a worse answer, not just a slower one.

The JMRI sweep, 25 queries, first came out at 39%. That's a strong number and I almost left it there. What made me distrust it was noticing the baseline runs in that sweep were taking noticeably longer in wall-clock time than the coldstart runs, more than the token counts alone explained. The machine running the sweep was also doing other work at the time, and the baseline's heavier reliance on repeated full-file reads and directory walks made it more sensitive to that contention than coldstart's smaller, targeted calls were. The savings number wasn't purely measuring the tool. It was partly measuring a machine under uneven load.

I reran the JMRI sweep in isolation, no other processes competing for CPU. The real number is 31%, recall at parity rather than better. Fifteen points lower than the first run.

## Why the correction is the point

It would have been easy to keep the first number. Nobody auditing a percentage on a website reruns your benchmark. But a number you can't explain how you got is not a number, it's a claim, and the difference matters most exactly when nobody's checking. The methodology has to be something a skeptical reader could redo: real repository, fixed query list, controlled machine, counted from the actual transcript's usage records rather than eyeballed from a printed summary, same as the process in the tokens post.

The gap between the two real numbers is informative in its own right. Arches at 64% and JMRI at 31% are not the same win, and averaging them into one blended figure would have erased the reason they differ. Java's verbosity and build tooling change what a single turn costs in that codebase, which changes how much a tool that reduces turns can save. A single number implies the saving is a property of the tool. Two numbers, from two different codebases, show it's a property of the tool interacting with the codebase, which is the truer and less flattering thing to say.

## The two numbers, stated plainly

Arches: 27-query sweep, 64% fewer tokens than the no-tool baseline, recall two points better. JMRI: 25-query sweep, 31% fewer tokens, recall at parity. Both measured the same way, on real applications, against a baseline doing the same task without coldstart. If you run this on your own codebase and get a different number, that's expected, not a contradiction, because the number was never a property of the tool alone.
