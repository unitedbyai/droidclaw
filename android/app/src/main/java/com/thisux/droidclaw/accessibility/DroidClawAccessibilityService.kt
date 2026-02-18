package com.thisux.droidclaw.accessibility

import android.accessibilityservice.AccessibilityService
import android.content.ComponentName
import android.content.Context
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityManager
import android.view.accessibility.AccessibilityNodeInfo
import com.thisux.droidclaw.model.UIElement
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking

class DroidClawAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "DroidClawA11y"
        val isRunning = MutableStateFlow(false)
        val lastScreenTree = MutableStateFlow<List<UIElement>>(emptyList())
        var instance: DroidClawAccessibilityService? = null

        fun isEnabledOnDevice(context: Context): Boolean {
            val am = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
            val ourComponent = ComponentName(context, DroidClawAccessibilityService::class.java)
            return am.getEnabledAccessibilityServiceList(AccessibilityEvent.TYPES_ALL_MASK)
                .any { it.resolveInfo.serviceInfo.let { si ->
                    ComponentName(si.packageName, si.name) == ourComponent
                }}
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        Log.i(TAG, "Accessibility service connected")
        instance = this
        isRunning.value = true
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // We capture on-demand via getScreenTree(), not on every event
    }

    override fun onInterrupt() {
        Log.w(TAG, "Accessibility service interrupted")
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.i(TAG, "Accessibility service destroyed")
        instance = null
        isRunning.value = false
    }

    fun getScreenTree(): List<UIElement> {
        // Retry with increasing delays — apps like Contacts on Vivo
        // can take 500ms+ to render after a cold launch
        val delays = longArrayOf(50, 100, 200, 300, 500)
        for (delayMs in delays) {
            val root = rootInActiveWindow
            if (root != null) {
                try {
                    val elements = ScreenTreeBuilder.capture(root)
                    // If we got a root but zero elements, the app may still be loading.
                    // Retry unless this is the last attempt.
                    if (elements.isEmpty() && delayMs < delays.last()) {
                        root.recycle()
                        runBlocking { delay(delayMs) }
                        continue
                    }
                    lastScreenTree.value = elements
                    return elements
                } finally {
                    root.recycle()
                }
            }
            runBlocking { delay(delayMs) }
        }
        Log.w(TAG, "rootInActiveWindow null or empty after retries")
        return emptyList()
    }

    fun findNodeAt(x: Int, y: Int): AccessibilityNodeInfo? {
        val root = rootInActiveWindow ?: return null
        return findNodeAtRecursive(root, x, y)
    }

    private fun findNodeAtRecursive(
        node: AccessibilityNodeInfo,
        x: Int,
        y: Int
    ): AccessibilityNodeInfo? {
        val rect = android.graphics.Rect()
        node.getBoundsInScreen(rect)

        if (!rect.contains(x, y)) {
            node.recycle()
            return null
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findNodeAtRecursive(child, x, y)
            if (found != null) {
                node.recycle()
                return found
            }
        }

        return if (node.isClickable || node.isLongClickable || node.isEditable) {
            node
        } else {
            node.recycle()
            null
        }
    }
}
