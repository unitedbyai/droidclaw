# Voice Overlay Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add voice-activated overlay to the Android app — tap pill, speak a goal, send it for execution.

**Architecture:** Android captures audio via `AudioRecord`, streams base64 PCM chunks over the existing WebSocket to the Bun server. Server buffers chunks and calls Groq Whisper API every ~2s for partial transcripts (fast batch, not true streaming). On "send", server gets final transcript and fires it into `runPipeline()` — the same path as web dashboard goals. Android overlay shows a glowing gradient border during listening and renders live transcript text.

**Tech Stack:** Kotlin/Compose (Android), Bun/TypeScript (server), Groq Whisper API (STT), Ktor WebSocket (transport)

**Design doc:** `docs/plans/2026-02-20-voice-overlay-design.md`

---

### Task 1: Add Voice Protocol Types (shared package)

**Files:**
- Modify: `packages/shared/src/protocol.ts:1-46`

**Step 1: Add voice message types to DeviceMessage union**

In `packages/shared/src/protocol.ts`, add three new variants to the `DeviceMessage` type after the `stop_goal` line (line 11):

```typescript
export type DeviceMessage =
  | { type: "auth"; apiKey: string; deviceInfo?: DeviceInfo }
  | { type: "screen"; requestId: string; elements: UIElement[]; screenshot?: string; packageName?: string }
  | { type: "result"; requestId: string; success: boolean; error?: string; data?: string }
  | { type: "goal"; text: string }
  | { type: "pong" }
  | { type: "heartbeat"; batteryLevel: number; isCharging: boolean }
  | { type: "apps"; apps: InstalledApp[] }
  | { type: "stop_goal" }
  // Voice overlay
  | { type: "voice_start" }
  | { type: "voice_chunk"; data: string }
  | { type: "voice_stop"; action: "send" | "cancel" };
```

**Step 2: Add voice response types to ServerToDeviceMessage union**

Add two new variants after the `goal_completed` line (line 38):

```typescript
  // Voice overlay
  | { type: "transcript_partial"; text: string }
  | { type: "transcript_final"; text: string }
```

**Step 3: Verify types compile**

Run: `cd packages/shared && bun run tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/shared/src/protocol.ts
git commit -m "feat(shared): add voice overlay protocol types"
```

---

### Task 2: Server Voice Handler

**Files:**
- Create: `server/src/ws/voice.ts`

**Step 1: Create the voice session handler**

This file manages one voice session per device: buffers audio chunks, calls Groq Whisper batch API for partial transcripts every ~2s, and produces the final transcript on stop.

```typescript
/**
 * Voice session handler for DroidClaw.
 *
 * Buffers PCM audio chunks from the Android device, periodically sends
 * accumulated audio to Groq Whisper for partial transcription, and
 * produces a final transcript when the user taps Send.
 *
 * Uses Groq's OpenAI-compatible /audio/transcriptions endpoint (batch,
 * not streaming) — but sends intermediate chunks every ~2s to simulate
 * live streaming text.
 */

import type { ServerWebSocket } from "bun";
import type { WebSocketData } from "./sessions.js";

interface VoiceSession {
  chunks: Buffer[];
  totalBytes: number;
  partialTimer: ReturnType<typeof setInterval> | null;
  lastPartialOffset: number; // byte offset of last partial sent
}

const activeSessions = new Map<string, VoiceSession>();

const GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const PARTIAL_INTERVAL_MS = 2000;
const WHISPER_MODEL = "whisper-large-v3";

/**
 * Call Groq Whisper transcription API with a PCM audio buffer.
 * Returns the transcribed text, or empty string on failure.
 */
async function transcribeAudio(
  pcmBuffer: Buffer,
  apiKey: string
): Promise<string> {
  // Convert raw PCM (16kHz, mono, 16-bit) to WAV for the API
  const wavBuffer = pcmToWav(pcmBuffer, 16000, 1, 16);

  const formData = new FormData();
  formData.append("file", new Blob([wavBuffer], { type: "audio/wav" }), "audio.wav");
  formData.append("model", WHISPER_MODEL);
  formData.append("language", "en");
  formData.append("response_format", "text");

  try {
    const res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });
    if (!res.ok) {
      console.error(`[Voice] Groq API error: ${res.status} ${await res.text()}`);
      return "";
    }
    return (await res.text()).trim();
  } catch (err) {
    console.error(`[Voice] Transcription failed: ${err}`);
    return "";
  }
}

/**
 * Wrap raw PCM data in a WAV header.
 */
function pcmToWav(
  pcm: Buffer,
  sampleRate: number,
  channels: number,
  bitsPerSample: number
): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

function sendToDevice(ws: ServerWebSocket<WebSocketData>, msg: Record<string, unknown>) {
  try {
    ws.send(JSON.stringify(msg));
  } catch { /* disconnected */ }
}

/**
 * Start a voice session for a device.
 */
export function handleVoiceStart(
  ws: ServerWebSocket<WebSocketData>,
  deviceId: string,
  groqApiKey: string
) {
  // Clean up any existing session
  handleVoiceCancel(deviceId);

  const session: VoiceSession = {
    chunks: [],
    totalBytes: 0,
    partialTimer: null,
    lastPartialOffset: 0,
  };

  // Start periodic partial transcription
  session.partialTimer = setInterval(async () => {
    if (session.totalBytes <= session.lastPartialOffset) return;
    if (session.totalBytes < 3200) return; // need at least 100ms of audio (16kHz * 2 bytes * 0.1s)

    const fullBuffer = Buffer.concat(session.chunks);
    const text = await transcribeAudio(fullBuffer, groqApiKey);
    if (text) {
      session.lastPartialOffset = session.totalBytes;
      sendToDevice(ws, { type: "transcript_partial", text });
    }
  }, PARTIAL_INTERVAL_MS);

  activeSessions.set(deviceId, session);
  console.log(`[Voice] Session started for device ${deviceId}`);
}

/**
 * Append an audio chunk to the session buffer.
 */
export function handleVoiceChunk(deviceId: string, base64Data: string) {
  const session = activeSessions.get(deviceId);
  if (!session) return;

  const chunk = Buffer.from(base64Data, "base64");
  session.chunks.push(chunk);
  session.totalBytes += chunk.length;
}

/**
 * Finalize the voice session: get final transcript and fire as goal.
 * Returns the final transcript text.
 */
export async function handleVoiceSend(
  ws: ServerWebSocket<WebSocketData>,
  deviceId: string,
  groqApiKey: string
): Promise<string> {
  const session = activeSessions.get(deviceId);
  if (!session) return "";

  // Stop partial timer
  if (session.partialTimer) clearInterval(session.partialTimer);

  // Get final transcript from complete audio
  const fullBuffer = Buffer.concat(session.chunks);
  const text = await transcribeAudio(fullBuffer, groqApiKey);

  // Send final transcript to device
  sendToDevice(ws, { type: "transcript_final", text });

  // Clean up
  activeSessions.delete(deviceId);
  console.log(`[Voice] Session finalized for device ${deviceId}: "${text}"`);

  return text;
}

/**
 * Cancel and discard a voice session.
 */
export function handleVoiceCancel(deviceId: string) {
  const session = activeSessions.get(deviceId);
  if (!session) return;

  if (session.partialTimer) clearInterval(session.partialTimer);
  activeSessions.delete(deviceId);
  console.log(`[Voice] Session cancelled for device ${deviceId}`);
}
```

**Step 2: Verify types compile**

Run: `cd server && bun run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add server/src/ws/voice.ts
git commit -m "feat(server): add voice session handler with Groq Whisper STT"
```

---

### Task 3: Wire Voice Messages into Server Device Handler

**Files:**
- Modify: `server/src/ws/device.ts:191-370`

**Step 1: Import voice handler functions**

At the top of `server/src/ws/device.ts`, add after line 7:

```typescript
import {
  handleVoiceStart,
  handleVoiceChunk,
  handleVoiceSend,
  handleVoiceCancel,
} from "./voice.js";
```

**Step 2: Add voice cases to the switch statement**

In `handleDeviceMessage()`, add new cases inside the `switch (msg.type)` block, before the `default` case (before line 364):

```typescript
    case "voice_start": {
      const deviceId = ws.data.deviceId!;
      const userId = ws.data.userId!;

      // Fetch user's LLM config to get Groq API key
      const configs = await db
        .select()
        .from(llmConfig)
        .where(eq(llmConfig.userId, userId))
        .limit(1);

      if (configs.length === 0 || !configs[0].apiKey) {
        sendToDevice(ws, {
          type: "transcript_final",
          text: "",
        });
        break;
      }

      handleVoiceStart(ws, deviceId, configs[0].apiKey);
      break;
    }

    case "voice_chunk": {
      const deviceId = ws.data.deviceId!;
      handleVoiceChunk(deviceId, (msg as unknown as { data: string }).data);
      break;
    }

    case "voice_stop": {
      const deviceId = ws.data.deviceId!;
      const userId = ws.data.userId!;
      const action = (msg as unknown as { action: string }).action;

      if (action === "cancel") {
        handleVoiceCancel(deviceId);
        break;
      }

      // action === "send" — finalize and fire goal
      const configs = await db
        .select()
        .from(llmConfig)
        .where(eq(llmConfig.userId, userId))
        .limit(1);

      const groqKey = configs[0]?.apiKey ?? "";
      const transcript = await handleVoiceSend(ws, deviceId, groqKey);

      if (transcript) {
        // Fire the transcript as a goal — reuse existing goal logic
        const persistentDeviceId = ws.data.persistentDeviceId!;

        if (activeSessions.has(deviceId)) {
          sendToDevice(ws, { type: "goal_failed", message: "Agent already running" });
          break;
        }

        const userLlmConfig: LLMConfig = {
          provider: configs[0].provider,
          apiKey: configs[0].apiKey,
          model: configs[0].model ?? undefined,
        };

        console.log(`[Pipeline] Starting voice goal for device ${deviceId}: ${transcript}`);
        const abortController = new AbortController();
        activeSessions.set(deviceId, { goal: transcript, abort: abortController });

        sendToDevice(ws, { type: "goal_started", sessionId: deviceId, goal: transcript });

        runPipeline({
          deviceId,
          persistentDeviceId,
          userId,
          goal: transcript,
          llmConfig: userLlmConfig,
          signal: abortController.signal,
          onStep(step) {
            sendToDevice(ws, {
              type: "step",
              step: step.stepNumber,
              action: step.action,
              reasoning: step.reasoning,
            });
          },
          onComplete(result) {
            activeSessions.delete(deviceId);
            sendToDevice(ws, {
              type: "goal_completed",
              success: result.success,
              stepsUsed: result.stepsUsed,
            });
          },
        }).catch((err) => {
          activeSessions.delete(deviceId);
          sendToDevice(ws, { type: "goal_failed", message: String(err) });
        });
      }

      break;
    }
```

**Step 3: Verify types compile**

Run: `cd server && bun run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add server/src/ws/device.ts
git commit -m "feat(server): wire voice messages into device handler"
```

---

### Task 4: Android Protocol Models

**Files:**
- Modify: `android/app/src/main/java/com/thisux/droidclaw/model/Protocol.kt`
- Modify: `android/app/src/main/java/com/thisux/droidclaw/model/AppState.kt`

**Step 1: Add voice message data classes to Protocol.kt**

Add after the `StopGoalMessage` class (after line 77):

```kotlin
@Serializable
data class VoiceStartMessage(
    val type: String = "voice_start"
)

@Serializable
data class VoiceChunkMessage(
    val type: String = "voice_chunk",
    val data: String  // base64-encoded PCM audio
)

@Serializable
data class VoiceStopMessage(
    val type: String = "voice_stop",
    val action: String  // "send" or "cancel"
)
```

**Step 2: Add transcript fields to ServerMessage**

In the `ServerMessage` data class (line 80-110), add two new fields after `setting`:

```kotlin
    val setting: String? = null,
    // Voice transcript fields
    val transcript: String? = null
```

Note: The `text` field already exists on `ServerMessage` (line 101), but it's used for goal text. We'll use the `type` field to distinguish — `transcript_partial` and `transcript_final` will use the `text` field for the transcript content.

Actually, the `text` field on `ServerMessage` already works. The `type` field distinguishes the message. No extra field needed.

**Step 3: Add OverlayMode enum to AppState.kt**

Check `AppState.kt` for existing enums, then add:

```kotlin
enum class OverlayMode {
    Idle,
    Listening,
    Executing
}
```

**Step 4: Build to verify**

Run: `cd android && ./gradlew compileDebugKotlin`
Expected: BUILD SUCCESSFUL

**Step 5: Commit**

```bash
git add android/app/src/main/java/com/thisux/droidclaw/model/Protocol.kt
git add android/app/src/main/java/com/thisux/droidclaw/model/AppState.kt
git commit -m "feat(android): add voice protocol models and overlay mode enum"
```

---

### Task 5: Android VoiceRecorder

**Files:**
- Create: `android/app/src/main/java/com/thisux/droidclaw/overlay/VoiceRecorder.kt`
- Modify: `android/app/src/main/AndroidManifest.xml`

**Step 1: Add RECORD_AUDIO permission to manifest**

In `AndroidManifest.xml`, add after the `SYSTEM_ALERT_WINDOW` permission (after line 14):

```xml
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
```

**Step 2: Create VoiceRecorder class**

```kotlin
package com.thisux.droidclaw.overlay

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Captures audio from the microphone and streams base64-encoded PCM chunks.
 *
 * Audio format: 16kHz, mono, 16-bit PCM (linear16).
 * Chunks are emitted every ~100ms via the [onChunk] callback.
 */
class VoiceRecorder(
    private val scope: CoroutineScope,
    private val onChunk: (base64: String) -> Unit
) {
    companion object {
        private const val TAG = "VoiceRecorder"
        private const val SAMPLE_RATE = 16000
        private const val CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
        private const val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT
        // ~100ms of audio at 16kHz mono 16-bit = 3200 bytes
        private const val CHUNK_SIZE = 3200
    }

    private var audioRecord: AudioRecord? = null
    private var recordingJob: Job? = null

    val isRecording: Boolean get() = recordingJob?.isActive == true

    fun hasPermission(context: Context): Boolean {
        return ContextCompat.checkSelfPermission(
            context, Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
    }

    fun start(): Boolean {
        if (isRecording) return false

        val bufferSize = maxOf(
            AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT),
            CHUNK_SIZE * 2
        )

        val record = try {
            AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE,
                CHANNEL_CONFIG,
                AUDIO_FORMAT,
                bufferSize
            )
        } catch (e: SecurityException) {
            Log.e(TAG, "Missing RECORD_AUDIO permission", e)
            return false
        }

        if (record.state != AudioRecord.STATE_INITIALIZED) {
            Log.e(TAG, "AudioRecord failed to initialize")
            record.release()
            return false
        }

        audioRecord = record
        record.startRecording()

        recordingJob = scope.launch(Dispatchers.IO) {
            val buffer = ByteArray(CHUNK_SIZE)
            while (isActive) {
                val bytesRead = record.read(buffer, 0, CHUNK_SIZE)
                if (bytesRead > 0) {
                    val base64 = Base64.encodeToString(
                        buffer.copyOf(bytesRead),
                        Base64.NO_WRAP
                    )
                    onChunk(base64)
                }
            }
        }

        Log.i(TAG, "Recording started")
        return true
    }

    fun stop() {
        recordingJob?.cancel()
        recordingJob = null
        audioRecord?.let {
            try {
                it.stop()
                it.release()
            } catch (e: Exception) {
                Log.w(TAG, "Error stopping AudioRecord", e)
            }
        }
        audioRecord = null
        Log.i(TAG, "Recording stopped")
    }
}
```

**Step 3: Build to verify**

Run: `cd android && ./gradlew compileDebugKotlin`
Expected: BUILD SUCCESSFUL

**Step 4: Commit**

```bash
git add android/app/src/main/AndroidManifest.xml
git add android/app/src/main/java/com/thisux/droidclaw/overlay/VoiceRecorder.kt
git commit -m "feat(android): add VoiceRecorder with AudioRecord PCM streaming"
```

---

### Task 6: Android Gradient Border Composable

**Files:**
- Create: `android/app/src/main/java/com/thisux/droidclaw/overlay/GradientBorder.kt`

**Step 1: Create the animated gradient border composable**

```kotlin
package com.thisux.droidclaw.overlay

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp

private val GradientColors = listOf(
    Color(0xFF8B5CF6), // purple
    Color(0xFF3B82F6), // blue
    Color(0xFF06B6D4), // cyan
    Color(0xFF10B981), // green
    Color(0xFF8B5CF6), // purple (loop)
)

/**
 * Full-screen animated gradient border drawn along all 4 edges.
 * The gradient colors rotate over a 3-second cycle.
 */
@Composable
fun GradientBorder() {
    val transition = rememberInfiniteTransition(label = "gradientRotation")
    val offset by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 3000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "gradientOffset"
    )

    val borderWidth = with(LocalDensity.current) { 4.dp.toPx() }

    Canvas(modifier = Modifier.fillMaxSize()) {
        val w = size.width
        val h = size.height

        // Shift colors based on animated offset
        val shiftedColors = shiftColors(GradientColors, offset)

        // Top edge
        drawRect(
            brush = Brush.horizontalGradient(shiftedColors),
            topLeft = Offset.Zero,
            size = Size(w, borderWidth)
        )

        // Bottom edge
        drawRect(
            brush = Brush.horizontalGradient(shiftedColors.reversed()),
            topLeft = Offset(0f, h - borderWidth),
            size = Size(w, borderWidth)
        )

        // Left edge
        drawRect(
            brush = Brush.verticalGradient(shiftedColors),
            topLeft = Offset.Zero,
            size = Size(borderWidth, h)
        )

        // Right edge
        drawRect(
            brush = Brush.verticalGradient(shiftedColors.reversed()),
            topLeft = Offset(w - borderWidth, 0f),
            size = Size(borderWidth, h)
        )
    }
}

/**
 * Rotate the color list by a fractional offset (0..1).
 */
private fun shiftColors(colors: List<Color>, offset: Float): List<Color> {
    if (colors.size < 2) return colors
    val n = colors.size
    val shift = (offset * n).toInt() % n
    return colors.subList(shift, n) + colors.subList(0, shift)
}
```

**Step 2: Build to verify**

Run: `cd android && ./gradlew compileDebugKotlin`
Expected: BUILD SUCCESSFUL

**Step 3: Commit**

```bash
git add android/app/src/main/java/com/thisux/droidclaw/overlay/GradientBorder.kt
git commit -m "feat(android): add animated gradient border composable"
```

---

### Task 7: Android Voice Overlay UI

**Files:**
- Create: `android/app/src/main/java/com/thisux/droidclaw/overlay/VoiceOverlayContent.kt`

**Step 1: Create the voice overlay composable**

This is the interactive bottom panel with transcript text and Send/Cancel buttons.

```kotlin
package com.thisux.droidclaw.overlay

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val AccentPurple = Color(0xFF8B5CF6)
private val PanelBackground = Color(0xCC1A1A1A)

/**
 * Voice overlay bottom panel: shows live transcript and Send/Cancel buttons.
 */
@Composable
fun VoiceOverlayContent(
    transcript: String,
    onSend: () -> Unit,
    onCancel: () -> Unit
) {
    val scrollState = rememberScrollState()

    // Auto-scroll to bottom when transcript changes
    LaunchedEffect(transcript) {
        scrollState.animateScrollTo(scrollState.maxValue)
    }

    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.BottomCenter
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp))
                .background(PanelBackground)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Listening indicator
            if (transcript.isEmpty()) {
                ListeningIndicator()
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    text = "Listening...",
                    color = Color.White.copy(alpha = 0.6f),
                    fontSize = 16.sp
                )
            } else {
                // Live transcript text
                Text(
                    text = transcript,
                    color = Color.White,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Medium,
                    textAlign = TextAlign.Center,
                    lineHeight = 32.sp,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(160.dp)
                        .verticalScroll(scrollState)
                        .padding(horizontal = 8.dp)
                )
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Action buttons
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterHorizontally)
            ) {
                OutlinedButton(
                    onClick = onCancel,
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = Color.White.copy(alpha = 0.7f)
                    ),
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                    Text("  Cancel", fontSize = 15.sp)
                }

                Button(
                    onClick = onSend,
                    enabled = transcript.isNotEmpty(),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = AccentPurple,
                        contentColor = Color.White
                    ),
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(
                        imageVector = Icons.Default.Send,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                    Text("  Send", fontSize = 15.sp)
                }
            }
        }
    }
}

/**
 * Pulsing dot animation while waiting for speech.
 */
@Composable
private fun ListeningIndicator() {
    val transition = rememberInfiniteTransition(label = "listening")
    val alpha by transition.animateFloat(
        initialValue = 0.3f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(800, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulseAlpha"
    )

    Box(
        modifier = Modifier
            .size(48.dp)
            .alpha(alpha)
            .clip(CircleShape)
            .background(AccentPurple)
    )
}
```

**Step 2: Build to verify**

Run: `cd android && ./gradlew compileDebugKotlin`
Expected: BUILD SUCCESSFUL

**Step 3: Commit**

```bash
git add android/app/src/main/java/com/thisux/droidclaw/overlay/VoiceOverlayContent.kt
git commit -m "feat(android): add voice overlay UI with transcript and action buttons"
```

---

### Task 8: Expand AgentOverlay State Machine

**Files:**
- Modify: `android/app/src/main/java/com/thisux/droidclaw/overlay/AgentOverlay.kt`

This is the biggest change. `AgentOverlay` gains:
- An `OverlayMode` state (idle/listening/executing)
- A second full-screen overlay view for the gradient border (non-touchable)
- A third overlay view for the voice panel (touchable)
- `VoiceRecorder` integration
- Methods to transition between modes

**Step 1: Rewrite AgentOverlay.kt**

Replace the entire file with the expanded state machine:

```kotlin
package com.thisux.droidclaw.overlay

import android.content.Intent
import android.graphics.PixelFormat
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.platform.ComposeView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.savedstate.SavedStateRegistry
import androidx.savedstate.SavedStateRegistryController
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import com.thisux.droidclaw.MainActivity
import com.thisux.droidclaw.model.OverlayMode
import com.thisux.droidclaw.ui.theme.DroidClawTheme

class AgentOverlay(private val service: LifecycleService) {

    private val windowManager = service.getSystemService(WindowManager::class.java)

    // Compose lifecycle support
    private val savedStateOwner = object : SavedStateRegistryOwner {
        private val controller = SavedStateRegistryController.create(this)
        override val lifecycle: Lifecycle get() = service.lifecycle
        override val savedStateRegistry: SavedStateRegistry get() = controller.savedStateRegistry
        init { controller.performRestore(null) }
    }

    // ── State ───────────────────────────────────────────────
    var mode = mutableStateOf(OverlayMode.Idle)
        private set
    var transcript = mutableStateOf("")
        private set

    // ── Callbacks (set by ConnectionService) ────────────────
    var onVoiceSend: ((String) -> Unit)? = null
    var onVoiceCancel: (() -> Unit)? = null

    // ── Views ───────────────────────────────────────────────
    private var pillView: ComposeView? = null
    private var borderView: ComposeView? = null
    private var voicePanelView: ComposeView? = null

    // ── Voice recorder ──────────────────────────────────────
    private var voiceRecorder: VoiceRecorder? = null
    var onAudioChunk: ((String) -> Unit)? = null

    // ── Layout params ───────────────────────────────────────

    private val pillParams = WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
        PixelFormat.TRANSLUCENT
    ).apply {
        gravity = Gravity.TOP or Gravity.START
        x = 0
        y = 200
    }

    private val borderParams = WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT
    )

    private val voicePanelParams = WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT
    )

    // ── Public API ──────────────────────────────────────────

    fun show() {
        if (pillView != null) return
        showPill()
    }

    fun hide() {
        hidePill()
        hideVoiceOverlay()
    }

    fun destroy() {
        hide()
        voiceRecorder?.stop()
        voiceRecorder = null
    }

    /**
     * Transition to listening mode: hide pill, show gradient border + voice panel,
     * start recording audio.
     */
    fun startListening() {
        mode.value = OverlayMode.Listening
        transcript.value = ""

        hidePill()
        showVoiceOverlay()

        // Start audio capture
        voiceRecorder = VoiceRecorder(
            scope = (service as LifecycleService).lifecycleScope,
            onChunk = { base64 -> onAudioChunk?.invoke(base64) }
        )
        voiceRecorder?.start()
    }

    /**
     * User tapped Send: stop recording, transition to executing.
     */
    fun sendVoice() {
        voiceRecorder?.stop()
        voiceRecorder = null
        mode.value = OverlayMode.Executing
        hideVoiceOverlay()
        showPill()
        onVoiceSend?.invoke(transcript.value)
    }

    /**
     * User tapped Cancel: stop recording, go back to idle.
     */
    fun cancelVoice() {
        voiceRecorder?.stop()
        voiceRecorder = null
        mode.value = OverlayMode.Idle
        hideVoiceOverlay()
        showPill()
        onVoiceCancel?.invoke()
    }

    /**
     * Update the live transcript text from a partial/final server response.
     */
    fun updateTranscript(text: String) {
        transcript.value = text
    }

    /**
     * Return to idle mode (e.g. after goal completion).
     */
    fun returnToIdle() {
        mode.value = OverlayMode.Idle
    }

    // ── Private: Pill overlay ───────────────────────────────

    private fun showPill() {
        if (pillView != null) return

        val view = ComposeView(service).apply {
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            setViewTreeLifecycleOwner(service)
            setViewTreeSavedStateRegistryOwner(savedStateOwner)
            setContent { OverlayContent() }
            setupDrag(this)
        }

        pillView = view
        windowManager.addView(view, pillParams)
    }

    private fun hidePill() {
        pillView?.let { windowManager.removeView(it) }
        pillView = null
    }

    // ── Private: Voice overlay (border + panel) ─────────────

    private fun showVoiceOverlay() {
        if (borderView != null) return

        // Layer 1: gradient border (non-touchable)
        val border = ComposeView(service).apply {
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            setViewTreeLifecycleOwner(service)
            setViewTreeSavedStateRegistryOwner(savedStateOwner)
            setContent {
                DroidClawTheme { GradientBorder() }
            }
        }
        borderView = border
        windowManager.addView(border, borderParams)

        // Layer 2: voice panel (touchable)
        val panel = ComposeView(service).apply {
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            setViewTreeLifecycleOwner(service)
            setViewTreeSavedStateRegistryOwner(savedStateOwner)
            setContent {
                DroidClawTheme {
                    VoiceOverlayContent(
                        transcript = transcript.value,
                        onSend = { sendVoice() },
                        onCancel = { cancelVoice() }
                    )
                }
            }
        }
        voicePanelView = panel
        windowManager.addView(panel, voicePanelParams)
    }

    private fun hideVoiceOverlay() {
        borderView?.let { windowManager.removeView(it) }
        borderView = null
        voicePanelView?.let { windowManager.removeView(it) }
        voicePanelView = null
    }

    // ── Private: Drag handling for pill ─────────────────────

    private fun setupDrag(view: View) {
        var initialX = 0
        var initialY = 0
        var initialTouchX = 0f
        var initialTouchY = 0f
        var isDragging = false

        view.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = pillParams.x
                    initialY = pillParams.y
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY
                    isDragging = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - initialTouchX).toInt()
                    val dy = (event.rawY - initialTouchY).toInt()
                    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) isDragging = true
                    pillParams.x = initialX + dx
                    pillParams.y = initialY + dy
                    windowManager.updateViewLayout(view, pillParams)
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!isDragging) {
                        // Tap on pill: activate voice mode if idle, open app otherwise
                        if (mode.value == OverlayMode.Idle) {
                            startListening()
                        } else {
                            val intent = Intent(service, MainActivity::class.java).apply {
                                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                                        Intent.FLAG_ACTIVITY_SINGLE_TOP or
                                        Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                            }
                            service.startActivity(intent)
                        }
                    }
                    true
                }
                else -> false
            }
        }
    }
}
```

**Step 2: Import lifecycleScope**

Make sure to add this import at the top:

```kotlin
import androidx.lifecycle.lifecycleScope
```

**Step 3: Build to verify**

Run: `cd android && ./gradlew compileDebugKotlin`
Expected: BUILD SUCCESSFUL

**Step 4: Commit**

```bash
git add android/app/src/main/java/com/thisux/droidclaw/overlay/AgentOverlay.kt
git commit -m "feat(android): expand AgentOverlay with voice mode state machine"
```

---

### Task 9: Wire Voice into ConnectionService

**Files:**
- Modify: `android/app/src/main/java/com/thisux/droidclaw/connection/ConnectionService.kt`
- Modify: `android/app/src/main/java/com/thisux/droidclaw/connection/CommandRouter.kt`

**Step 1: Add overlay voice state flow to ConnectionService companion**

In `ConnectionService.kt`, add to the companion object (after line 49):

```kotlin
        val overlayTranscript = MutableStateFlow("")
```

**Step 2: Wire overlay callbacks in ConnectionService.onCreate()**

After `overlay = AgentOverlay(this)` (line 68), add:

```kotlin
        overlay?.onAudioChunk = { base64 ->
            webSocket?.sendTyped(VoiceChunkMessage(data = base64))
        }
        overlay?.onVoiceSend = { _ ->
            webSocket?.sendTyped(VoiceStopMessage(action = "send"))
        }
        overlay?.onVoiceCancel = {
            webSocket?.sendTyped(VoiceStopMessage(action = "cancel"))
        }
```

**Step 3: Send voice_start when overlay enters listening mode**

In the `overlay?.onAudioChunk` setup, we also need to send `voice_start` when recording begins. Modify `startListening()` call flow. The cleanest approach: add a callback to AgentOverlay that fires on mode transition. But simpler: have ConnectionService observe the overlay and send `voice_start`.

Add after the callbacks above:

```kotlin
        // When overlay starts listening, notify server
        overlay?.let { ov ->
            lifecycleScope.launch {
                snapshotFlow { ov.mode.value }.collect { mode ->
                    when (mode) {
                        OverlayMode.Listening -> {
                            webSocket?.sendTyped(VoiceStartMessage())
                        }
                        else -> {}
                    }
                }
            }
        }
```

**Step 4: Handle transcript messages in CommandRouter**

In `CommandRouter.kt`, add cases in the `when (msg.type)` block (before line 74):

```kotlin
            "transcript_partial" -> {
                ConnectionService.overlayTranscript.value = msg.text ?: ""
                val overlay = ConnectionService.instance?.overlay
                overlay?.updateTranscript(msg.text ?: "")
                Log.d(TAG, "Transcript partial: ${msg.text}")
            }
            "transcript_final" -> {
                ConnectionService.overlayTranscript.value = msg.text ?: ""
                val overlay = ConnectionService.instance?.overlay
                overlay?.updateTranscript(msg.text ?: "")
                Log.d(TAG, "Transcript final: ${msg.text}")
            }
```

**Step 5: Make overlay accessible from ConnectionService for CommandRouter**

The `overlay` field in `ConnectionService` is currently `private`. We need to expose it. In `ConnectionService.kt`, change:

```kotlin
    private var overlay: AgentOverlay? = null
```

to:

```kotlin
    internal var overlay: AgentOverlay? = null
```

**Step 6: Add required imports**

In `ConnectionService.kt`, add:

```kotlin
import com.thisux.droidclaw.model.VoiceStartMessage
import com.thisux.droidclaw.model.VoiceChunkMessage
import com.thisux.droidclaw.model.VoiceStopMessage
import com.thisux.droidclaw.model.OverlayMode
import androidx.compose.runtime.snapshotFlow
```

In `CommandRouter.kt`, add:

```kotlin
import com.thisux.droidclaw.connection.ConnectionService
```

**Step 7: Return overlay to idle when goal completes**

In `CommandRouter.kt`, in the `"goal_completed"` case (line 65-68), add:

```kotlin
            "goal_completed" -> {
                currentGoalStatus.value = if (msg.success == true) GoalStatus.Completed else GoalStatus.Failed
                ConnectionService.instance?.overlay?.returnToIdle()
                Log.i(TAG, "Goal completed: success=${msg.success}, steps=${msg.stepsUsed}")
            }
```

**Step 8: Build to verify**

Run: `cd android && ./gradlew compileDebugKotlin`
Expected: BUILD SUCCESSFUL

**Step 9: Commit**

```bash
git add android/app/src/main/java/com/thisux/droidclaw/connection/ConnectionService.kt
git add android/app/src/main/java/com/thisux/droidclaw/connection/CommandRouter.kt
git commit -m "feat(android): wire voice recording and transcript into ConnectionService"
```

---

### Task 10: Runtime Permission Handling

**Files:**
- Modify: `android/app/src/main/java/com/thisux/droidclaw/overlay/AgentOverlay.kt`

**Step 1: Add permission check before starting voice mode**

In `AgentOverlay.startListening()`, add a permission check at the top:

```kotlin
    fun startListening() {
        // Check audio permission first
        val recorder = VoiceRecorder(
            scope = (service as LifecycleService).lifecycleScope,
            onChunk = { base64 -> onAudioChunk?.invoke(base64) }
        )
        if (!recorder.hasPermission(service)) {
            // Open the app to request permission
            val intent = Intent(service, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra("request_audio_permission", true)
            }
            service.startActivity(intent)
            return
        }

        mode.value = OverlayMode.Listening
        transcript.value = ""

        hidePill()
        showVoiceOverlay()

        voiceRecorder = recorder
        voiceRecorder?.start()
    }
```

**Step 2: Handle permission request in MainActivity**

In `MainActivity.kt`, check for the extra in `onCreate()` or `onNewIntent()` and request `RECORD_AUDIO` permission using the standard Activity result API. This is a one-time setup — once granted, the overlay will work directly.

Add a permission launcher in `MainActivity`:

```kotlin
    private val audioPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            // Permission granted, user can now tap overlay to start voice
            // No action needed — they'll tap the pill again
        }
    }
```

In `onCreate()` or `onNewIntent()`, check:

```kotlin
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.getBooleanExtra("request_audio_permission", false)) {
            audioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }
```

**Step 3: Build to verify**

Run: `cd android && ./gradlew compileDebugKotlin`
Expected: BUILD SUCCESSFUL

**Step 4: Commit**

```bash
git add android/app/src/main/java/com/thisux/droidclaw/overlay/AgentOverlay.kt
git add android/app/src/main/java/com/thisux/droidclaw/MainActivity.kt
git commit -m "feat(android): add RECORD_AUDIO runtime permission handling"
```

---

### Task 11: Integration Test — Manual Verification

**No code changes. Manual testing checklist.**

**Step 1: Build and install**

```bash
cd android && ./gradlew installDebug
```

**Step 2: Start server**

```bash
cd server && bun run dev
```

**Step 3: Test the flow**

1. Open DroidClaw app → connect to server
2. Go to home screen (app in background) → floating pill visible
3. Tap the pill → gradient border should appear around screen edges
4. Speak a command → transcript text should appear live on the overlay
5. Tap Send → pill reappears showing agent progress
6. Agent executes the goal
7. Pill returns to "Ready"

**Step 4: Test cancel flow**

1. Tap pill → voice mode activates
2. Speak something
3. Tap Cancel → pill reappears, no goal fired

**Step 5: Test permission flow**

1. Revoke RECORD_AUDIO permission in Android settings
2. Tap pill → should open app with permission request dialog
3. Grant permission → tap pill again → voice mode should work

**Step 6: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: integration fixes for voice overlay"
```
