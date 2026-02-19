package com.thisux.droidclaw.overlay

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Captures audio from the microphone and streams base64-encoded PCM chunks.
 *
 * Audio format: 16kHz, mono, 16-bit PCM (linear16).
 * Chunks are emitted every ~100ms via the [onChunk] callback.
 */
class VoiceRecorder(
    private val scope: CoroutineScope,
    private val onChunk: (base64: String) -> Unit
) {
    companion object {
        private const val TAG = "VoiceRecorder"
        private const val SAMPLE_RATE = 16000
        private const val CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
        private const val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT
        private const val CHUNK_SIZE = 3200 // ~100ms at 16kHz mono 16-bit
    }

    private var audioRecord: AudioRecord? = null
    private var recordingJob: Job? = null

    val isRecording: Boolean get() = recordingJob?.isActive == true

    fun hasPermission(context: Context): Boolean {
        return ContextCompat.checkSelfPermission(
            context, Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
    }

    fun start(): Boolean {
        if (isRecording) return false

        val bufferSize = maxOf(
            AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT),
            CHUNK_SIZE * 2
        )

        val record = try {
            AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE,
                CHANNEL_CONFIG,
                AUDIO_FORMAT,
                bufferSize
            )
        } catch (e: SecurityException) {
            Log.e(TAG, "Missing RECORD_AUDIO permission", e)
            return false
        }

        if (record.state != AudioRecord.STATE_INITIALIZED) {
            Log.e(TAG, "AudioRecord failed to initialize")
            record.release()
            return false
        }

        audioRecord = record
        record.startRecording()

        recordingJob = scope.launch(Dispatchers.IO) {
            val buffer = ByteArray(CHUNK_SIZE)
            while (isActive) {
                val bytesRead = record.read(buffer, 0, CHUNK_SIZE)
                if (bytesRead > 0) {
                    val base64 = Base64.encodeToString(
                        buffer.copyOf(bytesRead),
                        Base64.NO_WRAP
                    )
                    onChunk(base64)
                }
            }
        }

        Log.i(TAG, "Recording started")
        return true
    }

    fun stop() {
        recordingJob?.cancel()
        recordingJob = null
        audioRecord?.let {
            try {
                it.stop()
                it.release()
            } catch (e: Exception) {
                Log.w(TAG, "Error stopping AudioRecord", e)
            }
        }
        audioRecord = null
        Log.i(TAG, "Recording stopped")
    }
}
