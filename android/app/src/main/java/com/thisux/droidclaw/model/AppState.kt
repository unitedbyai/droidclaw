package com.thisux.droidclaw.model

enum class ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Error
}

enum class GoalStatus {
    Idle,
    Running,
    Completed,
    Failed
}

data class AgentStep(
    val step: Int,
    val action: String,
    val reasoning: String,
    val timestamp: Long = System.currentTimeMillis()
)

data class GoalSession(
    val sessionId: String,
    val goal: String,
    val steps: List<AgentStep>,
    val status: GoalStatus,
    val timestamp: Long = System.currentTimeMillis()
)

enum class OverlayMode {
    Idle,
    Listening,
    Executing
}
