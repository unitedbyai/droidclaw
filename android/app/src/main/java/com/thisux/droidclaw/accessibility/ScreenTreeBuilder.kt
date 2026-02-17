package com.thisux.droidclaw.accessibility

import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo
import com.thisux.droidclaw.model.UIElement
import java.security.MessageDigest

object ScreenTreeBuilder {

    fun capture(rootNode: AccessibilityNodeInfo?): List<UIElement> {
        if (rootNode == null) return emptyList()
        val elements = mutableListOf<UIElement>()
        walkTree(rootNode, elements, depth = 0, parentDesc = "")
        return elements
    }

    private fun walkTree(
        node: AccessibilityNodeInfo,
        elements: MutableList<UIElement>,
        depth: Int,
        parentDesc: String
    ) {
        try {
            val rect = Rect()
            node.getBoundsInScreen(rect)

            val text = node.text?.toString() ?: ""
            val contentDesc = node.contentDescription?.toString() ?: ""
            val viewId = node.viewIdResourceName ?: ""
            val className = node.className?.toString() ?: ""
            val displayText = text.ifEmpty { contentDesc }

            val isInteractive = node.isClickable || node.isLongClickable ||
                node.isEditable || node.isScrollable || node.isFocusable

            if (isInteractive || displayText.isNotEmpty()) {
                val centerX = (rect.left + rect.right) / 2
                val centerY = (rect.top + rect.bottom) / 2
                val width = rect.width()
                val height = rect.height()

                val action = when {
                    node.isEditable -> "type"
                    node.isScrollable -> "scroll"
                    node.isLongClickable -> "longpress"
                    node.isClickable -> "tap"
                    else -> "read"
                }

                elements.add(
                    UIElement(
                        id = viewId,
                        text = displayText,
                        type = className.substringAfterLast("."),
                        bounds = "[${rect.left},${rect.top}][${rect.right},${rect.bottom}]",
                        center = listOf(centerX, centerY),
                        size = listOf(width, height),
                        clickable = node.isClickable,
                        editable = node.isEditable,
                        enabled = node.isEnabled,
                        checked = node.isChecked,
                        focused = node.isFocused,
                        selected = node.isSelected,
                        scrollable = node.isScrollable,
                        longClickable = node.isLongClickable,
                        password = node.isPassword,
                        hint = node.hintText?.toString() ?: "",
                        action = action,
                        parent = parentDesc,
                        depth = depth
                    )
                )
            }

            for (i in 0 until node.childCount) {
                val child = node.getChild(i) ?: continue
                try {
                    walkTree(child, elements, depth + 1, className)
                } finally {
                    child.recycle()
                }
            }
        } catch (_: Exception) {
            // Node may have been recycled during traversal
        }
    }

    fun computeScreenHash(elements: List<UIElement>): String {
        val digest = MessageDigest.getInstance("MD5")
        for (el in elements) {
            digest.update("${el.id}|${el.text}|${el.center}".toByteArray())
        }
        return digest.digest().joinToString("") { "%02x".format(it) }.take(12)
    }
}
