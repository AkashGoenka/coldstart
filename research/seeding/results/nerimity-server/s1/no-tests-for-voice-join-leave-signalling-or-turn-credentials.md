---
id: no-tests-for-voice-join-leave-signalling-or-turn-credentials
type: lesson
kind: absence
title: "no tests for voice join, leave, signalling or TURN credentials"
scope: {"terms":["voice","joinVoiceChannel","onDisconnect","VOICE_","generate","TURN"]}
status: active
updated: 2026-11-17T03:24:41.927Z
edits: 1
---

# no tests for voice join, leave, signalling or TURN credentials

Searched the tests/ directory (helpers, servers, users) for voice, joinVoice, onDisconnect, VOICE_ and turn-credential names. Nothing matched, so the voice join gate, the signal relay, the disconnect-leave and the generate route are not covered by the test suite.

## Scope (absence — freshness = re-run this search)

- terms: `voice`, `joinVoiceChannel`, `onDisconnect`, `VOICE_`, `generate`, `TURN`
