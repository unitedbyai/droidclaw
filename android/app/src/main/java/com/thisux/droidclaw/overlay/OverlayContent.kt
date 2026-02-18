package com.thisux.droidclaw.overlay

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
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
private val PillBackground = Color(0xE6212121)

@Composable
fun OverlayContent() {
    DroidClawTheme {
        val connectionState by ConnectionService.connectionState.collectAsState()
        val goalStatus by ConnectionService.currentGoalStatus.collectAsState()
        val steps by ConnectionService.currentSteps.collectAsState()

        // Auto-reset Completed/Failed back to Idle after 3s
        var displayStatus by remember { mutableStateOf(goalStatus) }
        LaunchedEffect(goalStatus) {
            displayStatus = goalStatus
            if (goalStatus == GoalStatus.Completed || goalStatus == GoalStatus.Failed) {
                delay(3000)
                displayStatus = GoalStatus.Idle
            }
        }

        val isConnected = connectionState == ConnectionState.Connected

        val dotColor by animateColorAsState(
            targetValue = when {
                !isConnected -> Gray
                displayStatus == GoalStatus.Running -> Blue
                displayStatus == GoalStatus.Failed -> Red
                else -> Green
            },
            label = "dotColor"
        )

        val statusText = when {
            !isConnected -> "Offline"
            displayStatus == GoalStatus.Running -> {
                val last = steps.lastOrNull()
                if (last != null) {
                    val label = last.reasoning.ifBlank {
                        // Extract just the action name from the JSON string
                        Regex("""action[=:]?\s*(\w+)""").find(last.action)?.groupValues?.get(1) ?: "working"
                    }
                    "${last.step}: $label"
                } else "Running..."
            }
            displayStatus == GoalStatus.Completed -> "Done"
            displayStatus == GoalStatus.Failed -> "Stopped"
            else -> "Ready"
        }

        Row(
            modifier = Modifier
                .clip(RoundedCornerShape(24.dp))
                .background(PillBackground)
                .height(48.dp)
                .widthIn(min = 100.dp, max = 220.dp)
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            StatusDot(
                color = dotColor,
                pulse = isConnected && displayStatus == GoalStatus.Running
            )

            Text(
                text = statusText,
                color = Color.White,
                fontSize = 13.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false)
            )

            if (isConnected && displayStatus == GoalStatus.Running) {
                IconButton(
                    onClick = { ConnectionService.instance?.stopGoal() },
                    modifier = Modifier.size(28.dp),
                    colors = IconButtonDefaults.iconButtonColors(
                        contentColor = Color.White.copy(alpha = 0.8f)
                    )
                ) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "Stop goal",
                        modifier = Modifier.size(16.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun StatusDot(color: Color, pulse: Boolean) {
    if (pulse) {
        val transition = rememberInfiniteTransition(label = "pulse")
        val alpha by transition.animateFloat(
            initialValue = 1f,
            targetValue = 0.3f,
            animationSpec = infiniteRepeatable(
                animation = tween(800, easing = LinearEasing),
                repeatMode = RepeatMode.Reverse
            ),
            label = "pulseAlpha"
        )
        Box(
            modifier = Modifier
                .size(10.dp)
                .alpha(alpha)
                .clip(CircleShape)
                .background(color)
        )
    } else {
        Box(
            modifier = Modifier
                .size(10.dp)
                .clip(CircleShape)
                .background(color)
        )
    }
}
