package com.thisux.droidclaw.connection

import android.util.Base64
import android.util.Log
import com.thisux.droidclaw.accessibility.DroidClawAccessibilityService
import com.thisux.droidclaw.accessibility.GestureExecutor
import com.thisux.droidclaw.accessibility.ScreenTreeBuilder
import com.thisux.droidclaw.capture.ScreenCaptureManager
import com.thisux.droidclaw.model.AgentStep
import com.thisux.droidclaw.model.GoalStatus
import com.thisux.droidclaw.model.PongMessage
import com.thisux.droidclaw.model.ResultResponse
import com.thisux.droidclaw.model.ScreenResponse
import com.thisux.droidclaw.model.ServerMessage
import com.thisux.droidclaw.model.Workflow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.Json

class CommandRouter(
    private val webSocket: ReliableWebSocket,
    private val captureManager: ScreenCaptureManager?,
    private val onWorkflowSync: (suspend (List<Workflow>) -> Unit)? = null,
    private val onWorkflowCreated: (suspend (Workflow) -> Unit)? = null,
    private val onWorkflowDeleted: (suspend (String) -> Unit)? = null
) {
    companion object {
        private const val TAG = "CommandRouter"
        private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    }

    val currentGoalStatus = MutableStateFlow(GoalStatus.Idle)
    val currentSteps = MutableStateFlow<List<AgentStep>>(emptyList())
    val currentGoal = MutableStateFlow("")
    val currentSessionId = MutableStateFlow<String?>(null)

    private var gestureExecutor: GestureExecutor? = null

    fun updateGestureExecutor() {
        val svc = DroidClawAccessibilityService.instance
        gestureExecutor = if (svc != null) GestureExecutor(svc) else null
    }

    suspend fun handleMessage(msg: ServerMessage) {
        Log.d(TAG, "Handling: ${msg.type}")

        when (msg.type) {
            "get_screen" -> handleGetScreen(msg.requestId!!)
            "ping" -> webSocket.sendTyped(PongMessage())

            "tap", "type", "enter", "back", "home", "notifications",
            "longpress", "swipe", "launch", "clear", "clipboard_set",
            "clipboard_get", "paste", "open_url", "switch_app",
            "keyevent", "open_settings", "wait", "intent" -> handleAction(msg)

            "goal_started" -> {
                currentSessionId.value = msg.sessionId
                currentGoal.value = msg.goal ?: ""
                currentGoalStatus.value = GoalStatus.Running
                currentSteps.value = emptyList()
                Log.i(TAG, "Goal started: ${msg.goal}")
            }
            "step" -> {
                val step = AgentStep(
                    step = msg.step ?: 0,
                    action = msg.action?.toString() ?: "",
                    reasoning = msg.reasoning ?: ""
                )
                currentSteps.value = currentSteps.value + step
                Log.d(TAG, "Step ${step.step}: ${step.reasoning}")
            }
            "goal_completed" -> {
                currentGoalStatus.value = if (msg.success == true) GoalStatus.Completed else GoalStatus.Failed
                Log.i(TAG, "Goal completed: success=${msg.success}, steps=${msg.stepsUsed}")
            }
            "goal_failed" -> {
                currentGoalStatus.value = GoalStatus.Failed
                Log.i(TAG, "Goal failed: ${msg.message}")
            }

            "workflow_created" -> {
                val wfJson = msg.workflowJson ?: return
                try {
                    val wf = json.decodeFromString<Workflow>(wfJson)
                    onWorkflowCreated?.invoke(wf)
                    Log.i(TAG, "Workflow created: ${wf.name}")
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to parse workflow_created: ${e.message}")
                }
            }
            "workflow_synced" -> {
                val wfsJson = msg.workflowsJson ?: return
                try {
                    val wfs = json.decodeFromString<List<Workflow>>(wfsJson)
                    onWorkflowSync?.invoke(wfs)
                    Log.i(TAG, "Workflows synced: ${wfs.size} workflows")
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to parse workflow_synced: ${e.message}")
                }
            }
            "workflow_deleted" -> {
                val id = msg.workflowId ?: return
                onWorkflowDeleted?.invoke(id)
                Log.i(TAG, "Workflow deleted: $id")
            }
            "workflow_goal" -> {
                val goal = msg.goal ?: return
                Log.i(TAG, "Workflow-triggered goal: $goal")
                // Submit as a regular goal via the WebSocket
                webSocket.sendTyped(com.thisux.droidclaw.model.GoalMessage(text = goal))
            }

            else -> Log.w(TAG, "Unknown message type: ${msg.type}")
        }
    }

    private fun handleGetScreen(requestId: String) {
        updateGestureExecutor()
        val svc = DroidClawAccessibilityService.instance
        val elements = svc?.getScreenTree() ?: emptyList()
        val packageName = try {
            svc?.rootInActiveWindow?.packageName?.toString()
        } catch (_: Exception) { null }

        var screenshot: String? = null
        if (elements.isEmpty()) {
            val bytes = captureManager?.capture()
            if (bytes != null) {
                screenshot = Base64.encodeToString(bytes, Base64.NO_WRAP)
            }
        }

        val screenHash = if (elements.isNotEmpty()) {
            ScreenTreeBuilder.computeScreenHash(elements)
        } else null

        val response = ScreenResponse(
            requestId = requestId,
            elements = elements,
            screenHash = screenHash,
            screenshot = screenshot,
            packageName = packageName
        )
        webSocket.sendTyped(response)
    }

    private suspend fun handleAction(msg: ServerMessage) {
        updateGestureExecutor()
        val executor = gestureExecutor
        if (executor == null) {
            webSocket.sendTyped(
                ResultResponse(
                    requestId = msg.requestId!!,
                    success = false,
                    error = "Accessibility service not running"
                )
            )
            return
        }

        val result = executor.execute(msg)
        webSocket.sendTyped(
            ResultResponse(
                requestId = msg.requestId!!,
                success = result.success,
                error = result.error,
                data = result.data
            )
        )
    }

    fun reset() {
        currentGoalStatus.value = GoalStatus.Idle
        currentSteps.value = emptyList()
        currentGoal.value = ""
        currentSessionId.value = null
    }
}
