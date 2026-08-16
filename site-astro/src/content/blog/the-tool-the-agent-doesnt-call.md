---
title: "The tool the agent does not call"
description: "You can ship a tool, document it, and inject an instruction telling the agent to prefer it, and the agent will still reach for grep. Why availability is not adoption, with the mistake I shipped myself."
keywords: "agent tool adoption, MCP tools ignored, Claude Code hooks, agent tool use, coding agent instructions, tool design for agents"
kicker: "Adoption"
ogDescription: "Availability, documentation, and an explicit instruction still do not add up to adoption."
lead: "You can install a tool, document it, and add an explicit instruction telling the agent to prefer it over searching. Then you watch the session and the agent runs a text search anyway. This is the most consistent result I have from building agent tooling, and it took me a long time to stop treating it as a bug."
publishDate: 2026-07-25
readingTime: "8 min"
tags: ["tool-design", "adoption", "mcp"]
next: "from-four-tools-to-two"
---

I will start with my own numbers, because the argument is worthless coming from someone who only ever measured a competitor.

On a large Java repository, I checked how many of the agent's file reads had been preceded by the command I built specifically to tell it which files to read. The majority had not. The agent opened files without asking the tool that exists to rank them, in a repository where the tool was installed, working, and mentioned in the project instructions.

That's not a defect report about the model, it's a fact about how tool use actually happens, and it applies to whatever you are building too.

## Three things that look like adoption and are not

The mental model I had was a chain. Make the tool available, describe it clearly, and instruct the agent to use it. Each link seemed necessary and the set seemed sufficient. None of the three does what it appears to.

**Availability** means the tool is in the schema list (the menu of tools the agent is told it can call). The agent knows it exists in the same way you know your kitchen contains a mandoline. Knowing is not reaching.

**Documentation** is read once, at the start, along with everything else in your instruction files. By turn twenty it is a small and distant part of a conversation that now contains a stack trace, four files, and the user changing their mind. It has not been forgotten exactly. It has been outweighed.

**An explicit instruction** is the one that feels like it should be decisive. "Prefer this command over grep when locating code." It is unambiguous, it is in context, and the agent will even agree with it if you ask. It still loses at the moment of choice, because the moment of choice does not feel like a policy decision. It feels like knowing where to look.

## What the agent is actually doing

The agent has a habit that works.

Text search is universal, it is understood deeply from training, its failure mode is legible, and it never requires trusting an intermediary. When it returns nothing, that is informative. When it returns too much, the agent knows how to narrow it. There is no interpretation step between the tool and the answer.

A custom tool asks for something extra. It asks the agent to trust a ranking it cannot verify, in a format it has seen far less often, from a source it has no prior about. When your ranked output puts a file first, the agent has to decide whether to believe you. Believing you is a risk. Grepping is not.

The bar people assume is "is my tool better than a text search." The real bar is "is my tool better by enough, at the exact moment of choosing, to overcome a habit that is already working." Those are different bars, and only the second one predicts behaviour.

## The mistake I shipped, and so did someone else

There is a specific engineering error here that I want to describe properly, because I made it and then found the same shape in another project while reading its source, which suggests it is a trap rather than an oversight.

Most agent harnesses (the program actually running the agent loop, like Claude Code or Cursor) let you register a hook that fires before a tool runs. The obvious use is a gentle intervention: when the agent is about to run a search, notice, and point it at the better path first.

So you register the hook on the search tools. The dedicated grep tool, the file glob tool. Reasonable. That is where searching happens.

Then the agent runs a shell command that happens to contain `grep -r`.

Your hook is registered on the search tools. A shell call is not a search tool. Nothing fires. The agent searches the entire repository, pays for it, and your intervention was never in the path. The other project had the same structure, gated on exactly the tools an agent uses when it is being formal, and blind to the shell it uses when it is being quick.

Mine was slightly worse, and I only found it by reading my own code with this question in mind. The pattern that decides which calls to intercept did include the shell. The handler that runs afterwards only recognised one specific command inside it. So the hook fired on every shell call and then declined to act on almost all of them. It looked wired up. It was matching a broader surface than it could handle, which is the kind of bug that survives review because the tests pass and the logs look busy.

The general lesson is worth stating plainly. Instrument the surface the agent actually uses, not the one your tool taxonomy says it should. A general-purpose shell defeats every category-based gate, because anything can happen inside it.

## Injection is not adoption either

The next thing you try is stronger. Do not wait to be called. Inject the relevant context into the conversation when the user submits their prompt, so it arrives before the agent decides anything.

This works better and I use it. It is also not a solution to the adoption problem, for a reason that took me a while to see.

Injection only fires on a trigger you can compute in advance, from the user's words, before any work has happened. That is exactly when you know least. The user says "the export is timing out" and you have to guess what that is about from a sentence with no file names in it. The moment when the agent most needs the right pointer, three turns in, having just discovered the real symbol involved, is a moment when nothing is being injected because nothing new was submitted.

So injection covers the case where the vocabulary happened to match, and misses the case where the vocabulary changed under you. Useful, partial, and not a way to compel use of a tool.

## What actually moves the needle

I have ended up with three things that work, none of which involve trying harder to persuade the agent.

The first is to lose gracefully. If the agent is going to reach for a text search regardless, the tool should be useful in that world rather than sulking about it. Make the output good enough that when the agent does call it, the call ends the question, so the tool has earned a little more trust the next time the same situation comes up. Adoption is earned per call and it compounds.

The second is to make the output final. Most of the times my tool got called and then the agent grepped anyway, the reason was legible in the transcript: my output raised a question it did not answer. It listed a file without saying whether the file defines the thing or merely mentions it, so the agent opened it to check. That is not the agent being stubborn. That is my output being incomplete. Every follow-up you force is a place where the habit gets to reassert itself.

The third is to say when the answer is nothing. A tool that returns an empty result is nearly useless, because the agent cannot tell "not present" from "your tool failed" and will grep to find out. A tool that says the identifier does not appear anywhere in this repository has actually ended a line of inquiry. Negative results are answers if you state them as answers.

What I stopped doing is trying to steer. Instructions telling the agent when not to read a file did nothing measurable in my tests. The interventions that worked were all about the quality of what gets surfaced, never about the discipline of the agent receiving it.

## How this shaped coldstart

The design follows from the failure rather than from an ideal.

The commands are shell commands first, because the shell is where the agent already is. Results are ranked with the matched lines shown inline, so the common case is answered without opening anything. An empty result is phrased as a finding about the repository. And notes written after previous work are surfaced automatically at the start of a turn, because the note that has to be requested is the note that never gets read.

I would not claim this is solved. My own measurement says the agent still bypasses the tool often, and I would rather publish that than a story where instructions worked. If you are building something in this space, measure the bypass rate before you measure anything else. It is the number that tells you whether you have a tool or a feature nobody reaches for.
