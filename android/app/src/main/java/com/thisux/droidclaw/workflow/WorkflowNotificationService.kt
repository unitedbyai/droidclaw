package com.thisux.droidclaw.workflow

import android.content.ComponentName
import android.content.Context
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import com.thisux.droidclaw.DroidClawApp
import com.thisux.droidclaw.connection.ConnectionService
import com.thisux.droidclaw.model.ConnectionState
import com.thisux.droidclaw.model.MatchMode
import com.thisux.droidclaw.model.TriggerCondition
import com.thisux.droidclaw.model.Workflow
import com.thisux.droidclaw.model.WorkflowTriggerMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class WorkflowNotificationService : NotificationListenerService() {

    companion object {
        private const val TAG = "WorkflowNotifSvc"

        fun isEnabled(context: Context): Boolean {
            val flat = Settings.Secure.getString(
                context.contentResolver,
                "enabled_notification_listeners"
            ) ?: return false
            val ourComponent = ComponentName(context, WorkflowNotificationService::class.java)
            return flat.contains(ourComponent.flattenToString())
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        sbn ?: return
        val pkg = sbn.packageName ?: return
        // Ignore our own notifications
        if (pkg == packageName) return

        val extras = sbn.notification?.extras ?: return
        val title = extras.getCharSequence("android.title")?.toString() ?: ""
        val text = extras.getCharSequence("android.text")?.toString() ?: ""

        Log.d(TAG, "Notification from=$pkg title=$title text=$text")

        scope.launch {
            try {
                val app = application as DroidClawApp
                val workflows = app.workflowStore.workflows.first()
                val enabled = workflows.filter { it.enabled }

                for (wf in enabled) {
                    if (matchesWorkflow(wf, pkg, title, text)) {
                        Log.i(TAG, "Workflow '${wf.name}' matched notification from $pkg")
                        triggerWorkflow(wf, pkg, title, text)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to process notification for workflows: ${e.message}")
            }
        }
    }

    private fun matchesWorkflow(
        wf: Workflow,
        pkg: String,
        title: String,
        text: String
    ): Boolean {
        if (wf.conditions.isEmpty()) return false
        return wf.conditions.all { cond -> matchesCondition(cond, pkg, title, text) }
    }

    private fun matchesCondition(
        cond: TriggerCondition,
        pkg: String,
        title: String,
        text: String
    ): Boolean {
        val actual = when (cond.field) {
            "app_package" -> pkg
            "title" -> title
            "text" -> text
            else -> return false
        }
        return when (cond.matchMode) {
            MatchMode.contains -> actual.contains(cond.value, ignoreCase = true)
            MatchMode.exact -> actual.equals(cond.value, ignoreCase = true)
            MatchMode.regex -> try {
                Regex(cond.value, RegexOption.IGNORE_CASE).containsMatchIn(actual)
            } catch (_: Exception) { false }
        }
    }

    private fun triggerWorkflow(wf: Workflow, pkg: String, title: String, text: String) {
        val svc = ConnectionService.instance ?: return
        if (ConnectionService.connectionState.value != ConnectionState.Connected) {
            Log.w(TAG, "Cannot trigger workflow '${wf.name}': not connected")
            return
        }
        svc.sendWorkflowTrigger(
            WorkflowTriggerMessage(
                workflowId = wf.id,
                notificationApp = pkg,
                notificationTitle = title,
                notificationText = text
            )
        )
    }
}
