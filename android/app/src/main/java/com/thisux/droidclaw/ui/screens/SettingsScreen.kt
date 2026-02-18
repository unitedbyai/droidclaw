package com.thisux.droidclaw.ui.screens

import android.app.Activity
import android.content.Context
import android.media.projection.MediaProjectionManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.thisux.droidclaw.DroidClawApp
import com.thisux.droidclaw.accessibility.DroidClawAccessibilityService
import com.thisux.droidclaw.capture.ScreenCaptureManager
import com.thisux.droidclaw.util.BatteryOptimization
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen() {
    val context = LocalContext.current
    val app = context.applicationContext as DroidClawApp
    val scope = rememberCoroutineScope()

    val apiKey by app.settingsStore.apiKey.collectAsState(initial = "")
    val serverUrl by app.settingsStore.serverUrl.collectAsState(initial = "ws://localhost:8080")

    var editingApiKey by remember(apiKey) { mutableStateOf(apiKey) }
    var editingServerUrl by remember(serverUrl) { mutableStateOf(serverUrl) }

    val isAccessibilityEnabled by DroidClawAccessibilityService.isRunning.collectAsState()
    val isCaptureAvailable by ScreenCaptureManager.isAvailable.collectAsState()
    val hasConsent by ScreenCaptureManager.hasConsentState.collectAsState()
    val hasCaptureConsent = isCaptureAvailable || hasConsent

    var isBatteryExempt by remember { mutableStateOf(BatteryOptimization.isIgnoringBatteryOptimizations(context)) }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                isBatteryExempt = BatteryOptimization.isIgnoringBatteryOptimizations(context)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val projectionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            ScreenCaptureManager.storeConsent(result.resultCode, result.data)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text("Settings", style = MaterialTheme.typography.headlineMedium)

        OutlinedTextField(
            value = editingApiKey,
            onValueChange = { editingApiKey = it },
            label = { Text("API Key") },
            modifier = Modifier.fillMaxWidth(),
            visualTransformation = PasswordVisualTransformation(),
            singleLine = true
        )
        if (editingApiKey != apiKey) {
            OutlinedButton(
                onClick = { scope.launch { app.settingsStore.setApiKey(editingApiKey) } }
            ) {
                Text("Save API Key")
            }
        }

        OutlinedTextField(
            value = editingServerUrl,
            onValueChange = { editingServerUrl = it },
            label = { Text("Server URL") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )
        if (editingServerUrl != serverUrl) {
            OutlinedButton(
                onClick = { scope.launch { app.settingsStore.setServerUrl(editingServerUrl) } }
            ) {
                Text("Save Server URL")
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        Text("Setup Checklist", style = MaterialTheme.typography.titleMedium)

        ChecklistItem(
            label = "API key configured",
            isOk = apiKey.isNotBlank(),
            actionLabel = null,
            onAction = {}
        )

        ChecklistItem(
            label = "Accessibility service",
            isOk = isAccessibilityEnabled,
            actionLabel = "Enable",
            onAction = { BatteryOptimization.openAccessibilitySettings(context) }
        )

        ChecklistItem(
            label = "Screen capture permission",
            isOk = hasCaptureConsent,
            actionLabel = "Grant",
            onAction = {
                val mgr = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                projectionLauncher.launch(mgr.createScreenCaptureIntent())
            }
        )

        ChecklistItem(
            label = "Battery optimization disabled",
            isOk = isBatteryExempt,
            actionLabel = "Disable",
            onAction = { BatteryOptimization.requestExemption(context) }
        )
    }
}

@Composable
private fun ChecklistItem(
    label: String,
    isOk: Boolean,
    actionLabel: String?,
    onAction: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (isOk) {
                MaterialTheme.colorScheme.secondaryContainer
            } else {
                MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.3f)
            }
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    imageVector = if (isOk) Icons.Filled.CheckCircle else Icons.Filled.Error,
                    contentDescription = if (isOk) "OK" else "Missing",
                    tint = if (isOk) Color(0xFF4CAF50) else MaterialTheme.colorScheme.error
                )
                Text(label)
            }
            if (!isOk && actionLabel != null) {
                OutlinedButton(onClick = onAction) {
                    Text(actionLabel)
                }
            }
        }
    }
}
