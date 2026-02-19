# Voice Overlay — Design Document

**Date:** 2026-02-20
**Status:** Approved
**Approach:** Stream audio over existing WebSocket (Approach A)

## Overview

Add a voice-activated overlay to DroidClaw's Android app. User taps the floating pill → full-screen glowing gradient border appears → speech is streamed to the server for real-time transcription → live text appears on screen → tap Send to execute as a goal.

## User Flow

```
[IDLE] → tap pill → [LISTENING] → tap send → [EXECUTING] → done → [IDLE]
                          ↓
                     tap cancel
                          ↓
                       [IDLE]
```

### States

**IDLE** — Existing floating pill: `● Ready`, draggable, tappable.

**LISTENING** — Pill disappears. Full-screen overlay:
- Animated gradient border around all 4 screen edges (purple → blue → cyan → green cycle, ~3s)
- Large transcribed text in center, updating live word-by-word
- Bottom: `Send` (primary) + `Cancel` (secondary) buttons
- Audio recording starts immediately on transition

**EXECUTING** — Overlay collapses back to pill. Pill shows agent progress as today.

**IDLE (post-completion)** — Pill shows `● Done` for 3s, then `● Ready`.

## Audio Streaming Protocol

### Android → Server

| Message | Description |
|---------|-------------|
| `{type: "voice_start"}` | Recording begun |
| `{type: "voice_chunk", data: "<base64>"}` | ~100ms PCM chunks, 16kHz mono 16-bit |
| `{type: "voice_stop", action: "send"}` | User tapped Send — finalize & execute goal |
| `{type: "voice_stop", action: "cancel"}` | User tapped Cancel — discard |

### Server → Android

| Message | Description |
|---------|-------------|
| `{type: "transcript_partial", text: "..."}` | Live streaming partial transcript |
| `{type: "transcript_final", text: "..."}` | Final complete transcript |

### Flow

1. Android sends `voice_start` → server opens streaming connection to Groq Whisper
2. Android streams `voice_chunk` every ~100ms → server pipes PCM to Groq
3. Groq sends partial transcriptions → server relays as `transcript_partial`
4. User taps Send → Android sends `voice_stop` with `action: "send"`
5. Server flushes final audio → gets `transcript_final` → sends to Android → fires goal into agent loop
6. Cancel: `voice_stop` with `action: "cancel"` → server discards Groq session, no goal

### Audio Format

- Sample rate: 16kHz
- Channels: mono
- Bit depth: 16-bit PCM (linear16)
- Bandwidth: ~32KB/sec
- Encoding for WebSocket: base64 text frames

## Full-Screen Gradient Overlay

Two separate overlay layers managed by `AgentOverlay`:

### Layer 1 — Gradient Border (non-interactive)

- `TYPE_APPLICATION_OVERLAY` with `FLAG_NOT_TOUCHABLE | FLAG_NOT_FOCUSABLE`
- `MATCH_PARENT` — covers entire screen
- Compose renders animated gradient strips (~6dp) along all 4 edges
- Colors: purple → blue → cyan → green → purple, infinite rotation ~3s cycle
- Implementation: `drawBehind` modifier with 4 `LinearGradient` brushes, animated offset via `rememberInfiniteTransition`
- Center is fully transparent — pass-through to apps behind

### Layer 2 — Text + Buttons (interactive)

- `TYPE_APPLICATION_OVERLAY` with `FLAG_NOT_FOCUSABLE` (tappable, no keyboard steal)
- Positioned at bottom ~40% of screen
- Semi-transparent dark background `Color(0xCC000000)`
- Contents:
  - Transcribed text: 24-28sp, white, center-aligned, auto-scrolls
  - Subtle pulse/waveform animation while listening
  - Bottom row: `Send` button (accent) + `Cancel` button (muted)

### Why Two Layers

Android overlays cannot be partially touchable. The gradient border must be `FLAG_NOT_TOUCHABLE` (pass-through) while the text/button area must be tappable. Separate `WindowManager` views with different flags solve this.

## Server-Side STT Handler

New file: `src/voice.ts`

### Responsibilities

- On `voice_start`: open Groq Whisper streaming connection
- On `voice_chunk`: pipe decoded PCM to Groq stream
- On `voice_stop` (send): flush stream, get final transcript, trigger `runAgent()` with transcript as goal
- On `voice_stop` (cancel): close Groq stream, discard

### Fallback

If Groq streaming is unavailable, buffer all chunks server-side. On `voice_stop`, send complete audio as single Whisper API call. No live words — final text appears all at once. Always works.

### Goal Execution

After `transcript_final`, call existing `runAgent()` from `kernel.ts` — identical to web dashboard goals. No changes to agent loop.

## Files Changed

| File | Change | Scope |
|------|--------|-------|
| `android/.../AndroidManifest.xml` | Add `RECORD_AUDIO` permission | Minor |
| `android/.../overlay/AgentOverlay.kt` | State machine: idle/listening/executing, manage 2 overlay layers | Major |
| `android/.../overlay/OverlayContent.kt` | New composables: `GradientBorder`, `VoiceOverlayContent`, `LiveTranscriptText` | Major |
| `android/.../overlay/VoiceRecorder.kt` | **New file.** `AudioRecord` capture + chunked base64 streaming | New |
| `android/.../connection/ConnectionService.kt` | Handle voice messages, route transcript events to overlay | Medium |
| `android/.../model/Protocol.kt` | New message data classes for voice protocol | Minor |
| `src/voice.ts` | **New file.** Groq Whisper streaming STT handler | New |
| `src/kernel.ts` | Route voice WebSocket messages to `voice.ts` | Minor |

### Untouched

`actions.ts`, `skills.ts`, `workflow.ts`, `sanitizer.ts`, `llm-providers.ts`, `config.ts`, `constants.ts`

## Permissions

- `RECORD_AUDIO` — new runtime permission, requested on first voice activation
- `SYSTEM_ALERT_WINDOW` — already granted (existing overlay)
- `INTERNET` — already granted

## Difficulty Assessment

**Overall: Medium.** Estimated 3-4 days.

- Android `AudioRecord` → WebSocket streaming: well-documented, straightforward
- Full-screen gradient overlay animation: standard Compose `Canvas` + `rememberInfiniteTransition`
- Groq Whisper streaming API: documented, Bun handles WebSocket/HTTP streaming natively
- Two-layer overlay management: minor complexity in `AgentOverlay` state machine
- No risky unknowns — all components have clear precedents
