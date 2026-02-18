package com.thisux.droidclaw.connection

import android.util.Log
import com.thisux.droidclaw.model.AuthMessage
import com.thisux.droidclaw.model.ConnectionState
import com.thisux.droidclaw.model.DeviceInfoMsg
import com.thisux.droidclaw.model.ServerMessage
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readText
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class ReliableWebSocket(
    private val scope: CoroutineScope,
    private val onMessage: suspend (ServerMessage) -> Unit
) {
    companion object {
        private const val TAG = "ReliableWS"
        private const val MAX_BACKOFF_MS = 30_000L
    }

    @PublishedApi
    internal val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    private val _state = MutableStateFlow(ConnectionState.Disconnected)
    val state: StateFlow<ConnectionState> = _state

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage

    private val outbound = Channel<String>(Channel.BUFFERED)
    private var connectionJob: Job? = null
    private var client: HttpClient? = null
    private var backoffMs = 1000L
    private var shouldReconnect = true

    var deviceId: String? = null
        private set

    fun connect(serverUrl: String, apiKey: String, deviceInfo: DeviceInfoMsg) {
        shouldReconnect = true
        connectionJob?.cancel()
        connectionJob = scope.launch {
            while (shouldReconnect && isActive) {
                try {
                    _state.value = ConnectionState.Connecting
                    _errorMessage.value = null
                    connectOnce(serverUrl, apiKey, deviceInfo)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.e(TAG, "Connection failed: ${e.message}")
                    _state.value = ConnectionState.Error
                    _errorMessage.value = e.message
                }
                if (shouldReconnect && isActive) {
                    Log.i(TAG, "Reconnecting in ${backoffMs}ms")
                    delay(backoffMs)
                    backoffMs = (backoffMs * 2).coerceAtMost(MAX_BACKOFF_MS)
                }
            }
        }
    }

    private suspend fun connectOnce(serverUrl: String, apiKey: String, deviceInfo: DeviceInfoMsg) {
        val httpClient = HttpClient(OkHttp) {
            install(WebSockets) {
                pingIntervalMillis = 30_000
            }
        }
        client = httpClient

        val wsUrl = serverUrl.trimEnd('/') + "/ws/device"

        httpClient.webSocket(wsUrl) {
            // Auth handshake
            val authMsg = AuthMessage(apiKey = apiKey, deviceInfo = deviceInfo)
            send(Frame.Text(json.encodeToString(authMsg)))
            Log.i(TAG, "Sent auth message")

            // Wait for auth response
            val authFrame = incoming.receive() as? Frame.Text
                ?: throw Exception("Expected text frame for auth response")

            val authResponse = json.decodeFromString<ServerMessage>(authFrame.readText())
            when (authResponse.type) {
                "auth_ok" -> {
                    deviceId = authResponse.deviceId
                    _state.value = ConnectionState.Connected
                    _errorMessage.value = null
                    backoffMs = 1000L
                    Log.i(TAG, "Authenticated, deviceId=$deviceId")
                }
                "auth_error" -> {
                    shouldReconnect = false
                    _state.value = ConnectionState.Error
                    _errorMessage.value = authResponse.message ?: "Authentication failed"
                    close()
                    return@webSocket
                }
                else -> {
                    throw Exception("Unexpected auth response: ${authResponse.type}")
                }
            }

            // Launch outbound sender
            val senderJob = launch {
                for (msg in outbound) {
                    send(Frame.Text(msg))
                }
            }

            // Read incoming messages
            try {
                for (frame in incoming) {
                    if (frame is Frame.Text) {
                        val text = frame.readText()
                        try {
                            val msg = json.decodeFromString<ServerMessage>(text)
                            onMessage(msg)
                        } catch (e: Exception) {
                            Log.e(TAG, "Failed to parse message: ${e.message}")
                        }
                    }
                }
            } finally {
                senderJob.cancel()
            }
        }

        httpClient.close()
        client = null
        _state.value = ConnectionState.Disconnected
    }

    fun send(message: String) {
        outbound.trySend(message)
    }

    inline fun <reified T> sendTyped(message: T) {
        send(json.encodeToString(message))
    }

    fun disconnect() {
        shouldReconnect = false
        connectionJob?.cancel()
        connectionJob = null
        client?.close()
        client = null
        _state.value = ConnectionState.Disconnected
        _errorMessage.value = null
        deviceId = null
    }
}
