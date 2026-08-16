---
title: "From four tools to two"
description: "An origin story told through deletions: the two traversal tools that were really missing fields, the architectural role labels, and the server that served nothing. What survived was two operations."
keywords: "tool design for AI agents, MCP server design, CLI for coding agents, code index architecture, deleting features, agent tool surface"
kicker: "Design"
ogDescription: "An origin story told through deletions. What survived was two operations, and the cutting was the design work."
lead: "This is an origin story told through deletions. Almost everything I consider a real design decision in this project was a removal, and each one taught me something I could not have reasoned my way to beforehand."
publishDate: 2026-07-25
readingTime: "12 min"
tags: ["design", "origin-story", "mcp"]
next: "notes-should-be-written-by-whoever-read-the-code"
---

The tool now has two operations. One finds the files relevant to a concept. One takes a single file and returns its shape along with who uses it. That is the whole navigation surface.

It started with four. There was an overview operation for locating files, a structure operation for inspecting one, and two traversal operations: trace the dependencies of a thing, and trace the impact of changing it. That set looks well designed to me even now. It maps cleanly onto the four questions an agent actually has.

Both traversal operations were deleted. The path there is more instructive than the destination.

## Deletion one: the two tools that were really missing fields

The important thing about removing the traversal tools is what did not get removed. The graph stayed. The import edges, the call edges, the reverse lookups, all of it survived and is still there.

What went away was the idea that reaching that data deserved its own front door. The relationships became fields on the output of the operations that were already being called.

The reason is a pattern I only saw by reading a lot of session transcripts in a row. The traversal tools were never called first. They could not be, because you cannot trace the impact of a symbol until you know which symbol, and finding that out is what the other two tools were for. Every single invocation of a traversal tool followed an invocation of a different tool, in the previous step, answering a question that the previous step's output had raised and failed to answer.

Once you see it stated that way the conclusion is forced. A tool that is only ever called immediately after another tool, in response to a gap in that tool's output, isn't really a tool: it's a field missing from that output. And keeping it as a separate operation means the agent pays a full extra round trip to get information the first call could have included.

That is a much worse trade than it looks, because a round trip in an agent session is not a cheap operation. Every turn re-sends the entire conversation so far. Splitting one answer across two calls does not cost you a small message. It costs you the whole context again.

So the relationships moved into the results. Asking where something lives now tells you what imports it in the same breath, and asking about a file returns who calls each of its symbols without a second question. Four operations became two, and the capability count did not go down.

<figure class="wide essay-fig ">
<div class="fig-plot">
<svg viewBox="0 0 920 330" role="img" aria-labelledby="r2t r2d">
<title id="r2t">Two operations became fields on the other two</title>
<desc id="r2d">Top row: a first call finds the files but its output raises a question it cannot answer, so a second call traces the callers before the answer arrives. Bottom row: the same answer in one call, because the relationships are returned as fields of the first result.</desc>
<defs>
<filter id="r2" x="-6%" y="-6%" width="112%" height="112%">
<feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="2" seed="7" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G"/>
</filter>
</defs>
<g filter="url(#r2)">
<rect class="f-box" x="70" y="74" width="250" height="62" rx="6"/>
<rect class="f-box" x="400" y="74" width="250" height="62" rx="6"/>
<rect class="f-box-ok" x="730" y="74" width="120" height="62" rx="6"/>
<path class="f-pen" d="M330 105 L390 105"/>
<path class="f-pen" d="M379 99 L390 105 M379 111 L390 105"/>
<path class="f-pen" d="M660 105 L720 105"/>
<path class="f-pen" d="M709 99 L720 105 M709 111 L720 105"/>
<rect class="f-box" x="70" y="244" width="580" height="62" rx="6"/>
<rect class="f-box-ok" x="730" y="244" width="120" height="62" rx="6"/>
<path class="f-pen" d="M660 275 L720 275"/>
<path class="f-pen" d="M709 269 L720 275 M709 281 L720 275"/>
</g>
<text class="f-head" x="70" y="50" text-anchor="start">four operations</text>
<text class="f-head" x="70" y="220" text-anchor="start">two operations</text>
<text class="f-key" x="195" y="100" text-anchor="middle">find the files</text>
<text class="f-sub" x="195" y="120" text-anchor="middle">output raises a question it cannot answer</text>
<text class="f-key" x="525" y="100" text-anchor="middle">trace the callers</text>
<text class="f-sub" x="525" y="120" text-anchor="middle">a whole extra round trip</text>
<text class="f-key" x="790" y="110" text-anchor="middle">answer</text>
<text class="f-key" x="360" y="270" text-anchor="middle">find the files: callers and importers already in the result</text>
<text class="f-sub" x="360" y="290" text-anchor="middle">the relationships became fields, the graph never went anywhere</text>
<text class="f-key" x="790" y="280" text-anchor="middle">answer</text>
<text class="f-note" x="525" y="180" text-anchor="middle">this turn re-sent the entire conversation to ask one follow-up</text>
</svg>
</div>
<figcaption>The traversal tools were never called first: every invocation followed another call, answering a gap the previous output had left. A tool only ever called that way is a missing field, and keeping it separate charged a full round trip for it.</figcaption>
</figure>

## The part that did go down, stated honestly

One thing was genuinely lost and I would rather name it than let it be discovered.

The impact tool could follow a chain. Ask what breaks if this signature changes and it would walk outward through several levels of callers. What replaced it does one hop. You get the direct callers of a symbol and the direct importers of a file, and if you want the level beyond that you ask again about one of the results.

This was a deliberate trade and it was recorded as a known regression at the time rather than quietly dropped. My reasoning was that multi-hop traversal is the rarest question by a wide margin, that the answers were long enough to be expensive when they did arrive, and that an agent given the first hop is entirely capable of asking for the second when it actually needs it. I still think that is right. It is a trade, though, and if your work is dominated by refactors across deep call chains you should know that this particular tool will make you do the walking.

## Why those fields are on by default

There is a middle step here that I got wrong twice, and it is the most transferable thing in this essay.

When the relationship data first moved into the other operations, I made it optional. Sensible, I thought. The data is expensive to render, most calls do not need it, so put it behind a parameter and describe the parameter well. I wrote careful documentation explaining exactly when to ask for importers and when to ask for callers.

The agent almost never set it.

I assumed the description was not clear enough, so I rewrote it as a bulleted list with examples, which is what you do when you think the problem is legibility. That version measured worse than the one before it, not neutral but actively worse, because the longer description was itself resident context on every turn, and it bought nothing.

The finding underneath is that an agent does not read a parameter list looking for opportunities. It has a goal, it forms an intent, and it fills in the arguments that intent requires. A parameter that would only be requested by an agent that already knew what it was going to find is not discoverable by describing it better. You cannot document your way to a behaviour the agent has no reason to attempt.

Which leaves two real options. Default it on and accept the cost, or move it to an operation that is already in the workflow for a different reason. I ended up doing both. The relationship data is on by default, and it lives on the operation the agent was going to call anyway.

The general version: if a capability requires the agent to opt in, and the agent only knows to opt in after seeing the result, it will not get used. Make it the default or fold it into something else. A third option of explaining it more clearly does not exist.

## Deletion three: the labels

The first version tried to tell the agent what each file *was*.

Results came back annotated. A file had an architectural role. It was flagged as an entry point or not. It carried a depth, meaning roughly how far it sat from the top of the dependency tree. The idea was that an agent facing an unfamiliar repository would benefit from being told which files were controllers and which were utilities, the way a good README would.

Every one of those fields is gone now, removed in a single commit that also switched the parser to work purely from the syntax tree.

The reason they went is that they were guesses wearing the costume of facts. "Entry point" isn't a property a parser can read off a file: it's a judgment call, produced by heuristics (rules of thumb) over path names and import counts, wrong often enough that the label ended up worse than silence. A file labelled a utility that is actually the core of the subsystem doesn't merely fail to help: it actively steers away from the answer, and does so in confident language.

The deeper problem is a division of labour. The agent reading my output is a language model. It is extremely good at looking at a path, a set of exported symbols, and a few lines of code and concluding "this is the request handler." That is the one thing in this pipeline that does not need my help. What it cannot do cheaply is scan two thousand files to find which ones to look at.

So the rule I ended up with: return evidence, never classification. Paths, symbol names, exports, references, line numbers, the matched lines themselves. Things I can point at in a file. No role labels, no capability tags, and no generated descriptions of what a file is for. Let the model do the interpreting, since it is better at it than my heuristics and it is going to redo the work anyway.

## Deletion four: the duplicate

A smaller one, included because the lesson is not the obvious one.

The command line had a verb for searching. The server exposed a differently named tool that did the same thing. There was also a second search verb that had been added earlier and never removed. When I finally compared the two search paths properly, one was a duplicate of the other closely enough that deleting it changed no behaviour at all, and the old scoring engine behind it had no remaining callers.

That is embarrassing in the ordinary way that any duplicated code is embarrassing. What makes it worth writing about is the naming half, which I had not thought of as a problem.

The shell command and the server tool had drifted into different names for one operation. Internally that was untidy. Externally it was worse than untidy, because the agent sees both surfaces. Instructions written for one do not transfer to the other. A note in the project guidance saying "prefer this command" fails silently when the agent is on the other surface and the name does not exist. Every piece of documentation had to be written twice or be wrong half the time.

So the tools were renamed to match the shell verbs exactly, the duplicate verb was dropped, and the dead scorer went with it. One operation, one name, whichever way you reach it.

The cost of an extra name isn't the code: it's that everything you write about your tool now has to be conditional.

## Deletion five: the server that served

The third removal is the one I would not have predicted.

The architecture had a background process, a daemon, that held the index in memory and answered queries over a local connection. This is the obvious shape. The index is expensive to build, so build it once, keep it warm, and have the command line be a thin client that asks the running process. There was a bridge layer and an HTTP daemon (a background server, listening for requests the way a website's server does) to do exactly this.

Both are deleted. The commit that did it is titled, accurately, "daemon serves nothing."

What replaced it is that the background process only maintains a cache on disk and answers nothing. Every query is a fresh short-lived process that reads that cache, computes, prints, and exits.

This looks like a downgrade if you think about it as a server. It stops looking like one once you count what actually goes wrong in practice. A server introduces a liveness problem (is it actually still running right now, or silently dead?), a port, a protocol, a version skew between client and server (the two sides quietly drifting out of agreement about how to talk to each other), and a class of failure where the daemon is running but wrong. A file on disk has none of that. The reader either finds a valid cache or it does not.

The saving I imagined I was getting from keeping things warm was also not where the time went. Reading a prepared cache from disk is fast. The expensive part was always building the index, and that still happens once, in the background, exactly as before. I had optimised the cheap half of the operation and paid for it with a whole category of bugs.

Splitting the roles cleanly, one writer that keeps the cache fresh and many readers that only read, removed more failure modes than any feature I have added.

## What the removals have in common

Looking back, each deletion was the same mistake wearing different clothes. In every case I had built for a model of the situation that turned out to be wrong.

With the traversal tools I assumed the agent's questions arrive independently. They arrive in chains, and a chain of two calls should usually have been one. With the optional parameters I assumed capability is discovered by reading. It is not; it is discovered by having it happen. With the labels I assumed the agent wanted interpretation. It wanted evidence, and it does its own interpreting better than my heuristics did. With the daemon I assumed the cost sat in serving queries. It sat in building the index.

None of these were reachable by thinking harder at the outset. They came from measuring, and in more than one case from reading my own code with a specific suspicion in mind rather than a general intention to review it.

## Why the surface stayed small after that

There is a straightforward argument for keeping the tool count low that I only understood after decomposing where an agent session's cost actually goes.

The definition of every tool you expose is part of the prompt. It is not a one-time registration. It is re-sent on every single turn for the entire session, and you are billed for it whether the agent uses that tool or not. A generous surface of a dozen well-documented operations is a standing charge on every conversation, including all the ones where none of them get called.

So a new operation has to clear a bar that is higher than "this would occasionally be useful." It has to be worth its rent across every session where it goes untouched. Most candidate features do not clear that, which is a much more decisive test than my previous instinct of adding anything that seemed helpful.

The other reason is adoption. An agent with two commands learns both. An agent with twelve has to choose, and choosing costs a step, and the fallback when choosing is hard is to skip the whole surface and run a text search. A small surface is easier to actually get used, which is not a soft benefit. It is the only benefit that matters, since an operation nobody calls has all of the cost and none of the value.

## What did not shrink

One part of the project went the other way, and the contrast is the point.

The notebook, where agents write down what they worked out after a real task, has grown steadily. It has its own set of commands, hooks in several editors, a linter, and a viewer. By the logic above that should be indefensible.

The difference is that navigation and memory are not the same problem, and only one of them is served by being small. Finding a file is a mechanical operation where the best implementation is boring and fast. Preserving what an investigation concluded is not mechanical at all. It needs writing, editing, staleness tracking, and a way to surface a note at the moment it is relevant rather than when someone remembers to ask.

Cutting to two operations was right for the part of the problem that is a lookup. It would have been the wrong instinct applied to the part that is a record. Knowing which half you are working on is most of the design.
