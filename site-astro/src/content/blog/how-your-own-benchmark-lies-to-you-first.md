---
title: "How your own benchmark lies to you first"
description: "Before a token-savings number can lie to a reader, it usually lied to whoever built it. Four concrete ways that happens, and the checks that catch each one before the number ships."
lead: "The last post was about catching someone else's bad number. This one is about not producing your own. Every guardrail here exists because I broke it first, on coldstart's own benchmark, and got a number that looked real until I checked it."
keywords: "how to benchmark an AI coding tool, benchmark methodology, token savings measurement, eval design, ground truth"
kicker: "Methodology"
ogDescription: "A benchmark can be run in good faith and still be wrong in a way that's invisible from inside it. Four specific failure modes, each one caught on a real run of coldstart's own eval."
publishDate: 2026-08-08
readingTime: "8 min"
tags: ["benchmark", "methodology", "cost"]
next: "what-a-graph-cannot-see"
---

[Why most token savings tools lie](/blog/why-most-token-savings-tools-lie/) is about a number someone else is showing you, and what to check before believing it. This one is earlier in the process: how the number gets built at all, and the specific ways a benchmark run in good faith still comes out wrong. All four of these are mistakes I made on coldstart's own eval, caught before the number shipped, not mistakes I'm describing from watching someone else make them.

## Don't let the query know the answer

A recall number (of the files a correct answer actually needs, how many the tool surfaced) is only honest if the query that produced it could plausibly have come from an agent that hadn't already seen the answer. That sounds obvious and it's easy to violate by accident. Early on, I hand-wrote a test query against a component I'd already found on disk, using a phrase pulled straight from its filename. The tool ranked it first. Of course it did. The query wasn't testing whether the tool could find that file. It was testing whether the tool could match a string against itself, because I'd already done the finding and encoded the result into the question.

Writing more careful queries doesn't fix this. A query written by someone who already knows the target file can't be trusted as evidence, no matter how careful they are: the leak is in the fact that the answer was already visible when the question was written, not in how the query is worded. The only queries that count are the ones a real agent actually asked while working a task blind, mined from the run's own transcript, not authored afterward to look plausible. If you don't have real transcripts yet, you don't have a recall number yet either.

## One arm, one variable

A comparison is only informative if exactly one thing differs between the arms being compared (an "arm" here just means one side of the comparison, like a run with coldstart on versus a run with coldstart off). This one breaks less obviously: I ran a no-tool baseline where the agent, left without navigation help, delegated part of the task to a sub-agent. That's a reasonable thing for an agent to do on its own, and it silently corrupted the comparison two different ways.

First, sub-agent delegation is itself a way of managing context, arguably the main alternative to a navigation tool. A baseline that uses it quietly stops being a "no tool" comparison: delegating is a different tool, so the cost difference between arms stopped being attributable to the thing I was actually trying to test. Second, and worse: a sub-agent's reads and greps happen in a separate context that doesn't appear in the main transcript. If you're building your ground-truth file list (the pre-decided list of files a correct answer has to include) from what the transcript shows was read, and part of the real exploration happened somewhere the transcript can't see, your ground truth is quietly missing files, and every recall number computed against it is wrong in a way that doesn't announce itself.

The fix is a flat rule, not a judgment call: forbid sub-agent delegation in both arms, verify from the transcript that neither one used it, and if delegation itself is worth measuring, make it a third arm with its own baseline, never a variable that leaks into an arm meant to isolate something else.

## Lock the environment, or re-run both arms together

The agent's working environment is part of what you're measuring, whether you intend it to be or not. Rules files, IDE and CLI versions, the model checkpoint behind the API: all of it shapes how an agent behaves, and none of it is the variable a token-savings benchmark is trying to isolate. Running the baseline arm one week and the tool-enabled arm the next, with the rules file having changed in between, means the gap between arms is now partly a gap between environments, and there's no way to retroactively separate the two once the earlier state is gone.

The fix costs nothing and is easy to skip anyway because it feels like overhead: pin the rules file for the duration of a benchmark cycle, record the tool and model versions alongside the results, and when you can't be certain the environment held steady, re-run both arms back to back rather than trusting a comparison across drift. Keeping your actual day-to-day environment active during the run is fine, arguably better than a sterile one. The requirement is only that both arms sit inside the same environment, not a clean one.

## Find the noise floor before you trust a delta

This one is different: not a discipline problem, but a fact about the system that's easy to not know until it costs you a wrong conclusion. coldstart's own indexer parses files in parallel batches, and completion order feeds into how its resolver breaks ties. Run the exact same code, on the exact same repository, twice in a row, and the count of resolved reference edges (the links coldstart's index draws between files, "this function calls that one") can come out different both times, not because anything changed, but because parallel completion order isn't guaranteed to replay identically. This is what people mean by a noise floor: how far a measurement moves on its own, from nothing but re-running it, with no real change behind it.

I hit this directly: a change under test showed 2,136 resolved edges against a baseline's 2,131 on the same repository, a five-edge gap that looked exactly like a regression worth chasing. Before chasing it, I ran the unchanged baseline against itself a second time. It came back at 2,135. The "regression" was sitting inside the range the baseline produces on its own, from nothing but rerunning it.

<figure class="wide essay-fig ">
<div class="fig-plot">
<svg viewBox="0 0 920 380" role="img" aria-labelledby="r9t r9d">
<title id="r9t">Same code, parsed twice, two different edge counts</title>
<desc id="r9d">A number line of resolved edge counts. Two hollow points mark the same unchanged baseline run twice, at 2131 and 2135, with a shaded band spanning between them representing the self-jitter of the unchanged code. A filled point marks the branch run at 2136, sitting just past the band's edge, close enough to fall inside the same noise rather than register as a real change.</desc>
<defs>
<filter id="r9" x="-6%" y="-6%" width="112%" height="112%">
<feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="2" seed="29" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G"/>
</filter>
</defs>
<g filter="url(#r9)">
<path class="f-axis" d="M90 300 L860 300"/>
<path class="f-tick" d="M291 300 L291 260"/>
<path class="f-tick" d="M593 300 L593 260"/>
<path class="f-tick" d="M669 300 L669 260"/>
<rect class="f-grow" x="291" y="210" width="302" height="80" rx="14"/>
<circle class="f-hop" cx="291" cy="250" r="11"/>
<circle class="f-hop" cx="593" cy="250" r="11"/>
<circle class="f-pin" cx="669" cy="250" r="9"/>
</g>
<text class="f-head" x="90" y="50" text-anchor="start">same code, run twice</text>
<text class="f-sub" x="90" y="71" text-anchor="start">resolved reference edges, identical input both times</text>
<text class="f-note" x="291" y="188" text-anchor="middle">2131</text>
<text class="f-note" x="593" y="188" text-anchor="middle">2135</text>
<text class="f-note" x="669" y="150" text-anchor="middle">2136, the branch run</text>
<text class="f-key" x="291" y="336" text-anchor="middle">baseline, run once</text>
<text class="f-key" x="593" y="336" text-anchor="middle">baseline, run again</text>
<text class="f-sub" x="440" y="230" text-anchor="middle">self-jitter band</text>
<text class="f-lab" x="669" y="358" text-anchor="middle">looked like a regression, wasn't</text>
</svg>
</div>
<figcaption>The baseline moved four edges just from being run twice, nothing else changed. The branch's five-edge gap from the first baseline run was inside that same band: a real difference would have had to clear it, not sit one edge past where the baseline's own noise already reaches.</figcaption>
</figure>

Six of the seven repositories in that sweep came back bit-identical between runs. Only the one that looked like a regression turned out to be the one whose count isn't guaranteed to come out the same twice, which is exactly backwards from what it looked like at first glance. Without the second baseline run, that five-edge gap gets chased as a bug or merged past as a false confirmation, and either way the conclusion is wrong for a reason that has nothing to do with the code. The general rule: before attributing any gap to the change under test, run the baseline against itself and see how far it moves on nothing. A gap smaller than that movement isn't evidence yet.

## The checklist

Four checks, applied before a number is trusted enough to write into a sentence with a percentage in it. Was every query pulled from a real run where the answer wasn't visible yet, not authored afterward by someone who already knew it? Do both arms differ in exactly one thing, with sub-agent delegation either banned in both or measured as its own arm? Did the environment hold steady across both arms, or get re-run together when it might not have? And has the baseline been run against itself at least once, so a gap has an actual noise floor to clear before it counts as real?

Arches's 64% and JMRI's 31%, the two numbers in the post before this one, are the numbers that were left standing after all four. Not because the methodology is exotic (none of these checks require anything more than re-running something you'd otherwise only run once), but because skipping any one of them produces a number that looks exactly as confident as the honest one, right up until someone tries to reproduce it.
