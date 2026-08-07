---
title: "Why an index of your code cannot answer the same question twice"
description: "A code graph makes each step of a search cheaper. It does not reduce the number of steps, and it never makes the second occurrence of a question cheaper than the first. Why that gap needs a different kind of record."
lead: "Building a graph of a repository is a good idea and it works. It is also the wrong shape for one specific job that people keep expecting it to do, and the reason is not a quality problem you can fix with better parsing."
keywords: "code knowledge graph, codebase index, call graph, code search ranking, agent codebase memory, static analysis limits"
kicker: "Codebase memory"
ogDescription: "A graph makes each hop cheaper. It does not reduce the number of hops, and the second time you ask, it is identical."
publishDate: 2026-07-25
readingTime: "9 min"
tags: ["codebase-memory", "call-graphs", "static-analysis"]
next: "the-tool-the-agent-doesnt-call"
---

There is a category of tool that parses your repository into a graph. Files, symbols, imports, calls, sometimes inheritance and route definitions. The agent gets operations for querying it: find this symbol, show what calls it, walk from here to there. Some of them render the graph in three dimensions and it looks genuinely impressive.

I have spent time inside one of these, reading its source and its database rather than its documentation. I want to start by conceding what it does well, because the criticism only means something after the concession.

## What a graph genuinely gives you

It makes each step cheaper.

Asking "what calls this function" without a graph means a text search, then reading candidates to work out which hits are real calls rather than a comment, a string, or an unrelated method with the same name. With a resolved call graph, the answer arrives directly. That is a real saving, it is not marketing, and any honest comparison has to start there.

The same applies to reverse imports, to inheritance chains, and to the general class of question where the answer is a relationship rather than a location. Text search is bad at those. A graph is good at them. Fine.

## The thing it does not change

What a graph makes cheaper is the individual hop. What it does not touch is how many hops you need.

Consider what actually happens when an agent is given a task in an unfamiliar repository. Almost none of it is graph-shaped. The task arrives as a sentence in a human's vocabulary, something like "the export is timing out for large accounts." There is no node called that. Before any relationship question can be asked, the agent has to work out which files this sentence is even about, and that is a discovery problem, not a traversal problem.

You cannot traverse a graph until you know where to enter it. Finding the entry point is the expensive part, and it is the part the graph does not help with.

When I traced what these tools do at that first step, the answer was blunter than I expected. The entry point is found by text search. A grep, essentially, against the repository, with the results then sorted using the graph. The graph is not being traversed at all in the common case. It is being used to rank the output of a text search.

## Ranking by popularity has a specific failure

That ranking step is worth looking at closely, because the way it usually works has a consequence people do not expect.

The natural signal a graph offers for ranking is how connected a node is. A file that many other files import is probably important. So results get ordered by something like incoming edge count, with adjustments for whether the hit is a function or a route, and penalties for vendored code and tests.

Read that scoring rule carefully and something is missing from it. The query. How well a file matches what you actually asked contributes nothing to its position. The ranking is a popularity prior, computed before your question existed and identical no matter what you type.

For a lot of questions that is fine, because popular files are often relevant. It fails in a specific and predictable way: any file that is important without being widely imported is structurally unrankable. A database migration. A configuration file. A one-off definition that exactly one caller uses. A test fixture that encodes the real expected behaviour. These have almost no incoming edges by construction, so they sort to the bottom regardless of how precisely they match the question.

And a fair share of real answers live in exactly those files. The migration is where the column was actually renamed. The config file is where the timeout is actually set. If your ranking is popularity, the leaf where the answer lives loses to a widely imported file that merely mentions the same word.

Relevance has to include the query. That sounds too obvious to state until you find a scoring function that omits it.

## More edges is not more correct edges

The other thing worth checking is what the edges mean.

Resolving a call from one file to another is hard in a dynamic language. You see a method being called on something, and to know which definition that refers to you need the type, which often is not written down. So resolvers guess. A common approach is to match on name: if exactly one function in the project has this name, link to it, and if several do, pick by some heuristic.

I pulled the edges out of one of these databases and looked at what the guesses were. A large share pointed at language builtins, which is technically true and useless: knowing that a piece of code calls a dictionary lookup tells you nothing about your repository. Another large share were cases where the resolver had many candidates with the same name and picked one. Sampling those at random, the ones I checked were wrong. One linked a call in JavaScript to a Python test fixture that happened to share a name.

The edge count was several times larger than the one I maintain. Once builtins and coin flips came out, the real gap was much smaller than the headline. This is not an accusation of bad faith. It is what happens when a number becomes a feature: the incentive is to count edges, and nothing in the interface distinguishes a resolved edge from a guess. Confidence is often recorded internally and then not shown to the agent, which means the agent treats a coin flip and a certainty identically.

If you are evaluating one of these, the useful question is not how many edges. It is what fraction of call sites resolved at all, and of those, how many had exactly one candidate. Those two numbers are the honest ones and they are rarely published.

## The part that actually bothers me

Everything so far is a quality argument, and quality arguments can be answered with better engineering. Someone can improve the resolver, add the query to the ranking, expose confidence. The next objection cannot be fixed that way, because it is about what kind of object a graph is.

A graph is derived from your source code. That is its great virtue. It is never out of date, because you can regenerate it, and if the code changed the graph changes with it.

It is also the limit. Everything in the graph is already in the code. The graph is a re-description, in a form that is faster to query. It contains no information that was not sitting in the repository already.

Which means it cannot record a conclusion.

Say someone spends two hours on a timeout bug. They check the obvious place, the request handler, and it is not there. They check the client configuration, also not there. Eventually they find that a connection pool is being exhausted by a retry loop three files away, and that two files have to change together because an invariant lives between them and neither one states it.

Now ask what of that is in the graph. The edges between those files, maybe, if the resolver was good. Not the fact that the handler was checked and cleared. Not the reason the two files are coupled. Not the invariant, which is not written anywhere in the code, which is precisely why the bug existed.

Six weeks later the same area breaks again. The graph is regenerated from the same source and it is byte for byte what it was before. It has learned nothing, because it is not the kind of thing that can learn. The second investigation starts exactly where the first one did, and re-derives the same conclusions at the same cost.

That is the claim in one line. A graph makes each hop cheaper. It does not reduce the number of hops, and it never makes the second occurrence of a question cheaper than the first.

<figure class="wide essay-fig ">
<div class="fig-plot">
<svg viewBox="0 0 920 360" role="img" aria-labelledby="r3t r3d">
<title id="r3t">The second investigation costs what the first one did</title>
<desc id="r3d">Two identical tracks of five hops ending in the same conclusion, separated by a regeneration of the graph. The second run repeats every hop of the first because nothing about the first was recorded.</desc>
<defs>
<filter id="r3" x="-6%" y="-6%" width="112%" height="112%">
<feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="2" seed="11" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G"/>
</filter>
</defs>
<g filter="url(#r3)">
<path class="f-axis" d="M90 108 L640 108"/>
<circle class="f-hop" cx="100" cy="108" r="9"/>
<circle class="f-hop" cx="230" cy="108" r="9"/>
<circle class="f-hop" cx="360" cy="108" r="9"/>
<circle class="f-hop" cx="490" cy="108" r="9"/>
<circle class="f-hop" cx="620" cy="108" r="9"/>
<rect class="f-box-ok" x="690" y="77" width="170" height="62" rx="6"/>
<path class="f-pen" d="M650 108 L680 108"/>
<path class="f-pen" d="M669 102 L680 108 M669 114 L680 108"/>
<path class="f-axis" d="M90 286 L640 286"/>
<circle class="f-hop" cx="100" cy="286" r="9"/>
<circle class="f-hop" cx="230" cy="286" r="9"/>
<circle class="f-hop" cx="360" cy="286" r="9"/>
<circle class="f-hop" cx="490" cy="286" r="9"/>
<circle class="f-hop" cx="620" cy="286" r="9"/>
<rect class="f-box-ok" x="690" y="255" width="170" height="62" rx="6"/>
<path class="f-pen" d="M650 286 L680 286"/>
<path class="f-pen" d="M669 280 L680 286 M669 292 L680 286"/>
<path class="f-div" d="M70 197 L860 197"/>
</g>
<text class="f-head" x="90" y="72" text-anchor="start">first investigation</text>
<text class="f-head" x="90" y="250" text-anchor="start">six weeks later, the same question</text>
<text class="f-lab" x="100" y="138" text-anchor="middle">hop 1</text>
<text class="f-lab" x="230" y="138" text-anchor="middle">hop 2</text>
<text class="f-lab" x="360" y="138" text-anchor="middle">hop 3</text>
<text class="f-lab" x="490" y="138" text-anchor="middle">hop 4</text>
<text class="f-lab" x="620" y="138" text-anchor="middle">hop 5</text>
<text class="f-lab" x="100" y="316" text-anchor="middle">hop 1</text>
<text class="f-lab" x="230" y="316" text-anchor="middle">hop 2</text>
<text class="f-lab" x="360" y="316" text-anchor="middle">hop 3</text>
<text class="f-lab" x="490" y="316" text-anchor="middle">hop 4</text>
<text class="f-lab" x="620" y="316" text-anchor="middle">hop 5</text>
<text class="f-key" x="775" y="113" text-anchor="middle">conclusion</text>
<text class="f-key" x="775" y="291" text-anchor="middle">conclusion</text>
<text class="f-sub" x="465" y="188" text-anchor="middle">the graph is regenerated from the same source and is byte for byte what it was</text>
<text class="f-note" x="465" y="222" text-anchor="middle">it has learned nothing, because it is not the kind of thing that can learn</text>
</svg>
</div>
<figcaption>A graph makes each hop cheaper. It does not reduce how many hops you need, and because everything in it was already in the source, it cannot hold a conclusion — so the second occurrence of a question costs what the first one did.</figcaption>
</figure>

## A note about the visualisation

Since it comes up: the three-dimensional rendering of your codebase is for you, not for the agent. The agent receives text. It never sees the picture. A beautiful graph view is a fine thing to build and I understand why it demos well, but it is evidence about the tool's presentation layer and not about whether an agent finished a task in fewer steps.

The metric that would settle these arguments is unglamorous: for a fixed set of tasks, how many actions did the agent take before it had the right answer. Steps, not tokens, because tokens follow from steps. I have not seen that number published by anyone, including by me, and I am wary of any comparison that leads with something else.

## What has to be different

If the missing thing is a conclusion, then the record has to be written by whoever reached it, and it has to be a separate object from the derived index.

That is the split coldstart is built around. There is a static index, and it is deliberately ordinary: it ranks files against the words in your question using paths, symbol names, exports, and references, and it can show you the shape of a file and who uses it. It is the cheap-hop layer and I make no larger claim for it.

Separately there is a notebook. After a real task, the agent writes down what it worked out, anchored to the files it actually used. That record is not derivable from the source, which is the whole point, and it is also the reason it can go stale in a way the index cannot. So each note carries the state of the files it was based on. If those files changed, the note is not served as truth. It is served as a claim that needs re-checking, which is roughly what a colleague saying "this was true last month" gives you.

Fewer notes that are true beat a large derived structure that cannot hold a conclusion. Both layers are useful. They are answering different questions, and the mistake worth avoiding is expecting the first one to do the second one's job.
