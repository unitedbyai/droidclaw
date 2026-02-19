package com.thisux.droidclaw.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class AuthMessage(
    val type: String = "auth",
    val apiKey: String,
    val deviceInfo: DeviceInfoMsg? = null
)

@Serializable
data class DeviceInfoMsg(
    val model: String,
    val manufacturer: String,
    val androidVersion: String,
    val screenWidth: Int,
    val screenHeight: Int,
    val batteryLevel: Int,
    val isCharging: Boolean
)

@Serializable
data class ScreenResponse(
    val type: String = "screen",
    val requestId: String,
    val elements: List<UIElement>,
    val screenHash: String? = null,
    val screenshot: String? = null,
    val packageName: String? = null
)

@Serializable
data class ResultResponse(
    val type: String = "result",
    val requestId: String,
    val success: Boolean,
    val error: String? = null,
    val data: String? = null
)

@Serializable
data class GoalMessage(
    val type: String = "goal",
    val text: String
)

@Serializable
data class PongMessage(
    val type: String = "pong"
)

@Serializable
data class HeartbeatMessage(
    val type: String = "heartbeat",
    val batteryLevel: Int,
    val isCharging: Boolean
)

@Serializable
data class InstalledAppInfo(
    val packageName: String,
    val label: String,
    val intents: List<String> = emptyList()
)

@Serializable
data class AppsMessage(
    val type: String = "apps",
    val apps: List<InstalledAppInfo>
)

@Serializable
data class StopGoalMessage(
    val type: String = "stop_goal"
)

@Serializable
data class VoiceStartMessage(
    val type: String = "voice_start"
)

@Serializable
data class VoiceChunkMessage(
    val type: String = "voice_chunk",
    val data: String
)

@Serializable
data class VoiceStopMessage(
    val type: String = "voice_stop",
    val action: String
)

@Serializable
data class ServerMessage(
    val type: String,
    val requestId: String? = null,
    val deviceId: String? = null,
    val message: String? = null,
    val sessionId: String? = null,
    val goal: String? = null,
    val success: Boolean? = null,
    val stepsUsed: Int? = null,
    val step: Int? = null,
    val action: JsonObject? = null,
    val reasoning: String? = null,
    val screenHash: String? = null,
    val x: Int? = null,
    val y: Int? = null,
    val x1: Int? = null,
    val y1: Int? = null,
    val x2: Int? = null,
    val y2: Int? = null,
    val duration: Int? = null,
    val text: String? = null,
    val packageName: String? = null,
    val url: String? = null,
    val code: Int? = null,
    // Intent fields
    val intentAction: String? = null,
    val intentUri: String? = null,
    val intentType: String? = null,
    val intentExtras: Map<String, String>? = null,
    val setting: String? = null
)
