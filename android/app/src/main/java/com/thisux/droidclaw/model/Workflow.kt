package com.thisux.droidclaw.model

import kotlinx.serialization.Serializable

@Serializable
enum class TriggerType {
    notification
}

@Serializable
enum class MatchMode {
    contains, exact, regex
}

@Serializable
data class TriggerCondition(
    val field: String,        // "app_package", "title", "text"
    val matchMode: MatchMode,
    val value: String
)

@Serializable
data class Workflow(
    val id: String,
    val name: String,
    val description: String,           // original natural-language input
    val triggerType: TriggerType = TriggerType.notification,
    val conditions: List<TriggerCondition> = emptyList(),
    val goalTemplate: String,          // sent to agent as a goal
    val enabled: Boolean = true,
    val createdAt: Long = System.currentTimeMillis()
)
