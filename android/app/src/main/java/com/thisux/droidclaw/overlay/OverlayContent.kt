package com.thisux.droidclaw.overlay

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.thisux.droidclaw.connection.ConnectionService
import com.thisux.droidclaw.model.ConnectionState
import com.thisux.droidclaw.model.GoalStatus
import com.thisux.droidclaw.ui.theme.DroidClawTheme
import kotlinx.coroutines.delay

private val Green = Color(0xFF4CAF50)
private val Blue = Color(0xFF2196F3)
private val Red = Color(0xFFF44336)
private val Gray = Color(0xFF9E9E9E)
private val PillBackground = Color(0xFF1A1A1A)

@Composable
fun OverlayContent(
    onTextTap: () -> Unit = {},
    onMicTap: () -> Unit = {},
    onStopTap: () -> Unit = {}
) {
    DroidClawTheme(darkTheme = true) {
        val connectionState by ConnectionService.connectionState.collectAsState()
        val goalStatus by ConnectionService.currentGoalStatus.collectAsState()
        val steps by ConnectionService.currentSteps.collectAsState()

        var displayStatus by remember { mutableStateOf(goalStatus) }
        LaunchedEffect(goalStatus) {
            displayStatus = goalStatus
            if (goalStatus == GoalStatus.Completed || goalStatus == GoalStatus.Failed) {
                delay(3000)
                displayStatus = GoalStatus.Idle
            }
        }

        val isConnected = connectionState == ConnectionState.Connected
        val isRunning = isConnected && displayStatus == GoalStatus.Running
        val isIdle = isConnected && displayStatus == GoalStatus.Idle
        val isDisconnected = !isConnected

        // Status dot color
        val dotColor by animateColorAsState(
            targetValue = when {
                isDisconnected -> Gray
                displayStatus == GoalStatus.Running -> Red
                displayStatus == GoalStatus.Completed -> Blue
                displayStatus == GoalStatus.Failed -> Gray
                else -> Green // idle + connected
            },
            label = "dotColor"
        )

        // Pulse animation for running state dot (only allocated when running)
        val dotScale = if (isRunning) {
            val transition = rememberInfiniteTransition(label = "pulse")
            val scale by transition.animateFloat(
                initialValue = 0.8f,
                targetValue = 1.3f,
                animationSpec = infiniteRepeatable(
                    animation = tween(800, easing = LinearEasing),
                    repeatMode = RepeatMode.Reverse
                ),
                label = "pulseScale"
            )
            scale
        } else {
            1f
        }

        // Status text
        val statusText = when {
            isDisconnected -> "offline"
            displayStatus == GoalStatus.Running -> {
                val latestStep = steps.lastOrNull()
                if (latestStep != null) {
                    "${latestStep.step}. ${latestStep.reasoning}"
                } else {
                    "starting.."
                }
            }
            displayStatus == GoalStatus.Completed -> "completed"
            displayStatus == GoalStatus.Failed -> "failed"
            else -> "ready" // idle + connected
        }

        // Text area clickable only when idle or disconnected
        val textClickable = isIdle || isDisconnected

        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .height(40.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(PillBackground)
                .padding(horizontal = 12.dp)
        ) {
            // Status dot
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .scale(dotScale)
                    .clip(CircleShape)
                    .background(dotColor)
            )

            Spacer(modifier = Modifier.width(8.dp))

            // Status text
            Text(
                text = statusText,
                color = Color.White,
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .widthIn(max = 200.dp)
                    .then(
                        if (textClickable) {
                            Modifier.clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = null,
                                onClick = onTextTap
                            )
                        } else {
                            Modifier
                        }
                    )
            )

            // Right icon (conditional)
            when {
                isIdle -> {
                    Spacer(modifier = Modifier.width(12.dp))
                    Icon(
                        imageVector = Icons.Filled.Mic,
                        contentDescription = "Voice input",
                        tint = Green,
                        modifier = Modifier
                            .size(20.dp)
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = null,
                                onClick = onMicTap
                            )
                    )
                }
                isRunning -> {
                    Spacer(modifier = Modifier.width(12.dp))
                    Icon(
                        imageVector = Icons.Filled.Close,
                        contentDescription = "Stop",
                        tint = Color.White.copy(alpha = 0.7f),
                        modifier = Modifier
                            .size(20.dp)
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = null,
                                onClick = onStopTap
                            )
                    )
                }
                // disconnected, completed, failed: no icon
            }
        }
    }
}
