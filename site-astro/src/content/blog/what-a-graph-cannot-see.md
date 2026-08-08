---
title: "What a graph cannot see"
description: "A real call graph, built by parsing syntax, still misses the couplings that live outside syntax entirely. A story from three hook scripts that shared no import and broke each other repeatedly."
lead: "coldstart's gs command builds a real graph off imports and calls, no guessing involved. Building it also showed me exactly where a graph like that runs out of road, and the answer wasn't a parsing gap I could fix."
keywords: "call graph limitations, AI coding agent architecture, static analysis limits, codebase coupling, notebook capture design"
kicker: "Architecture"
ogDescription: "Three scripts with zero import edges between them broke each other repeatedly for months, because their coupling lived in a shared filename convention, not in any syntax a graph could parse."
publishDate: 2026-08-08
readingTime: "7 min"
tags: ["architecture", "graph", "notebook"]
next: "where-the-tokens-go"
---

coldstart's `gs` command answers "who calls this" and "who imports this file" from a graph built by actually parsing the code: real imports resolved to real files, real call sites resolved to real function definitions. No inference, no guessing at intent. I trust that graph, and I've watched it save turns that would otherwise go into a grep and a manual trace. It's also taught me exactly where a graph like this, or any graph built by any method, quietly stops being able to help.

## Three files, zero edges, one bug

coldstart's own notebook has a capture step: something fires at the end of a session and writes down what the agent worked out. It runs a little differently depending on the host. Claude Code, Cursor, and Codex each have their own hook mechanism, their own transcript format, their own way of telling a script "the turn just ended." So there are three scripts: one for each host. None of them imports another. None of them calls another. If you ran any graph over that code, deterministic or LLM-generated, it would report exactly what it looks like: three unrelated files.

They are not unrelated. All three read and write the same marker file in a temp directory, and the exact shape of that filename, which pieces of session and agent identity get folded into it, has to match across all three or the whole mechanism silently breaks. Not at parse time. At runtime, in whichever host happens to run second.

<figure class="wide essay-fig ">
<div class="fig-plot">
<svg viewBox="0 0 920 380" role="img" aria-labelledby="r6t r6d">
<title id="r6t">Three files, zero edges, one real coupling</title>
<desc id="r6d">Three hook scripts drawn inside the graph's boundary with no edges between them, exactly what any import-and-call graph reports. Below the boundary, a dashed line the graph cannot draw connects all three through a shared marker-filename convention checked only at runtime.</desc>
<defs>
<filter id="r6" x="-6%" y="-6%" width="112%" height="112%">
<feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="2" seed="17" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G"/>
</filter>
</defs>
<g filter="url(#r6)">
<rect class="f-div" x="110" y="60" width="700" height="180" rx="16"/>
<circle class="f-hop" cx="250" cy="150" r="38"/>
<circle class="f-hop" cx="460" cy="150" r="38"/>
<circle class="f-hop" cx="670" cy="150" r="38"/>
<path class="f-mark" d="M250 188 C250 300 460 300 460 188"/>
<path class="f-mark" d="M460 188 C460 300 670 300 670 188"/>
<circle class="f-pin" cx="355" cy="300" r="6"/>
<circle class="f-pin" cx="565" cy="300" r="6"/>
</g>
<text class="f-head" x="70" y="40" text-anchor="start">what the graph draws</text>
<text class="f-sub" x="460" y="95" text-anchor="middle">zero edges between them — not a bug in the parser</text>
<text class="f-lab" x="250" y="215" text-anchor="middle">claude hook</text>
<text class="f-lab" x="460" y="215" text-anchor="middle">cursor hook</text>
<text class="f-lab" x="670" y="215" text-anchor="middle">codex hook</text>
<text class="f-note" x="460" y="352" text-anchor="middle">same marker filename, checked at runtime — no edge for this</text>
</svg>
</div>
<figcaption>Any graph built from imports and calls reports exactly this: three files, zero edges. The coupling that broke things repeatedly lived in a shared filename convention checked at runtime, and there is no AST node type to hang an edge on for that.</figcaption>
</figure>

## How the coupling actually broke things

This happened more than once, in slightly different ways, across a string of separate fixes. An early version keyed the marker by the repository root alone. That worked until a subagent, which shares its parent session's id, started a capture of its own, and its marker collided with the parent's, clobbering a worklist the parent hadn't finished with. Fixing that meant keying the marker by session and agent id together. Getting that fix into the Claude Code script and not immediately propagating the same key shape into the Cursor and Codex scripts reintroduced a version of the same class of bug in a different host later, because each script was edited as if it were self-contained, which, looking only at its imports, it was.

Across the real history of this feature, that same category of bug resurfaced across roughly a dozen separate fixes before the convention got made explicit and shared instead of copied three times by hand. Each individual fix looked complete, reviewed in isolation, because each script really does read clean on its own. The bug was never inside a script. It was in the gap between them, a gap no graph edge represents because there's no statement in the code that creates one.

## Why no graph catches this, however it's built

A parser walking an AST has no node type for "these two files agree on a string format by convention." There's nothing to attach an edge to. An LLM asked to summarize each file in isolation has the same blind spot for a different reason: understanding the coupling requires knowing that a constant in one file has to be checked against assumptions baked into two other files somewhere else in the repo, and that fact doesn't live in any one file's text. It lives in the incident history, the sequence of "we fixed it here and broke it there" that only exists in people's memory of what happened, or in a changelog nobody re-reads before touching that code again.

This isn't a case for a smarter graph. It's a case that some couplings are structurally invisible to any system that only looks at what's on the page right now, because the dependency is temporal and conventional rather than syntactic. Two files agreeing to format a string the same way is a real dependency. It just isn't one that shows up as an edge no matter how good your parser or your model is.

## What actually caught it

What ended the pattern wasn't a better graph. It was writing the incident down the moment it was understood, as a note attached to the files involved, saying plainly that these three scripts share a convention and any change to the marker shape has to be checked against all three. The next time someone, human or agent, opens one of those files, that note is sitting right there, and the fix starts from the actual failure history instead of from three files that each look complete on their own.

This isn't an argument against building a graph. coldstart's own `gs` relies on one, and it's exactly the right tool for the relationships it can see: real imports, real calls, real reference edges. It's an argument that a graph has an edge it fundamentally cannot draw, and the fix for that isn't a more thorough graph. It's remembering, in a form attached to the code, the things that broke because the graph didn't know to warn you.
