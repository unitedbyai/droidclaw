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
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.savedstate.SavedStateRegistry
import androidx.savedstate.SavedStateRegistryController
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import com.thisux.droidclaw.MainActivity
import com.thisux.droidclaw.connection.ConnectionService
import com.thisux.droidclaw.model.OverlayMode
import com.thisux.droidclaw.ui.theme.DroidClawTheme

class AgentOverlay(private val service: LifecycleService) {

    private val windowManager = service.getSystemService(WindowManager::class.java)
    private val dismissTarget = DismissTargetView(service)
    private val vignetteOverlay = VignetteOverlay(service)

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
    var onAudioChunk: ((String) -> Unit)? = null

    // ── Views ───────────────────────────────────────────────
    private var pillView: ComposeView? = null
    private var borderView: ComposeView? = null
    private var voicePanelView: ComposeView? = null

    // ── Voice recorder ──────────────────────────────────────
    private var voiceRecorder: VoiceRecorder? = null

    // ── Command panel ───────────────────────────────────────
    private val commandPanel = CommandPanelOverlay(
        service = service,
        onSubmitGoal = { goal ->
            val intent = Intent(service, ConnectionService::class.java).apply {
                action = ConnectionService.ACTION_SEND_GOAL
                putExtra(ConnectionService.EXTRA_GOAL, goal)
            }
            service.startService(intent)
        },
        onStartVoice = { startListening() },
        onDismiss = { show() }
    )

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
        dismissTarget.hide()
    }

    fun destroy() {
        hide()
        commandPanel.destroy()
        vignetteOverlay.destroy()
        voiceRecorder?.stop()
        voiceRecorder = null
    }

    fun showVignette() = vignetteOverlay.show()

    fun hideVignette() = vignetteOverlay.hide()

    fun startListening() {
        val recorder = VoiceRecorder(
            scope = service.lifecycleScope,
            onChunk = { base64 -> onAudioChunk?.invoke(base64) }
        )
        if (!recorder.hasPermission(service)) {
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

    fun sendVoice() {
        voiceRecorder?.stop()
        voiceRecorder = null
        mode.value = OverlayMode.Executing
        hideVoiceOverlay()
        showPill()
        onVoiceSend?.invoke(transcript.value)
    }

    fun cancelVoice() {
        voiceRecorder?.stop()
        voiceRecorder = null
        mode.value = OverlayMode.Idle
        hideVoiceOverlay()
        showPill()
        onVoiceCancel?.invoke()
    }

    fun updateTranscript(text: String) {
        transcript.value = text
    }

    fun returnToIdle() {
        mode.value = OverlayMode.Idle
    }

    fun showCommandPanel() {
        hide()
        commandPanel.show()
    }

    // ── Private: Pill overlay ───────────────────────────────

    private fun showPill() {
        if (pillView != null) return

        val view = ComposeView(service).apply {
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            setViewTreeLifecycleOwner(service)
            setViewTreeSavedStateRegistryOwner(savedStateOwner)
            setContent {
                OverlayContent(
                    onTextTap = {
                        hidePill()
                        commandPanel.show()
                    },
                    onMicTap = { startListening() },
                    onStopTap = { ConnectionService.instance?.stopGoal() }
                )
            }
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

        view.setOnTouchListener { v, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = pillParams.x
                    initialY = pillParams.y
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY
                    isDragging = false
                    // Let Compose also receive the DOWN event
                    false
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - initialTouchX).toInt()
                    val dy = (event.rawY - initialTouchY).toInt()
                    if (!isDragging && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
                        isDragging = true
                        dismissTarget.show()
                        // Cancel Compose's touch tracking so it doesn't
                        // fire a click when the drag ends
                        val cancel = MotionEvent.obtain(event).apply {
                            action = MotionEvent.ACTION_CANCEL
                        }
                        v.dispatchTouchEvent(cancel)
                        cancel.recycle()
                    }
                    if (isDragging) {
                        pillParams.x = initialX + dx
                        pillParams.y = initialY + dy
                        windowManager.updateViewLayout(view, pillParams)
                    }
                    isDragging
                }
                MotionEvent.ACTION_UP -> {
                    if (isDragging) {
                        val dismissed = dismissTarget.isOverTarget(event.rawX, event.rawY)
                        dismissTarget.hide()
                        if (dismissed) {
                            // Reset position to default so next show() starts clean
                            pillParams.x = 0
                            pillParams.y = 200
                            hide()
                        }
                        isDragging = false
                        true
                    } else {
                        isDragging = false
                        // Let Compose handle the tap via its clickable callbacks
                        false
                    }
                }
                else -> false
            }
        }
    }
}
