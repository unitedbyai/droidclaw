package com.thisux.droidclaw.capture

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import androidx.core.graphics.createBitmap
import androidx.core.graphics.get
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import kotlinx.coroutines.flow.MutableStateFlow
import java.io.ByteArrayOutputStream

class ScreenCaptureManager(private val context: Context) {

    companion object {
        private const val TAG = "ScreenCapture"
        val isAvailable = MutableStateFlow(false)

        // Stores MediaProjection consent for use by ConnectionService
        var consentResultCode: Int? = null
        var consentData: Intent? = null

        // Expose consent as state so UI can react immediately
        val hasConsentState = MutableStateFlow(false)

        fun storeConsent(resultCode: Int, data: Intent?) {
            consentResultCode = resultCode
            consentData = data
            hasConsentState.value = (resultCode == Activity.RESULT_OK && data != null)
        }

        fun hasConsent(): Boolean = consentResultCode != null && consentData != null
    }

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var screenWidth = 720
    private var screenHeight = 1280
    private var screenDensity = DisplayMetrics.DENSITY_DEFAULT

    fun initialize(resultCode: Int, data: Intent) {
        val mgr = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        mediaProjection = mgr.getMediaProjection(resultCode, data)

        val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getRealMetrics(metrics)
        screenWidth = metrics.widthPixels
        screenHeight = metrics.heightPixels
        screenDensity = metrics.densityDpi

        val scale = 720f / screenWidth
        val captureWidth = 720
        val captureHeight = (screenHeight * scale).toInt()

        imageReader = ImageReader.newInstance(captureWidth, captureHeight, PixelFormat.RGBA_8888, 2)
        virtualDisplay = mediaProjection?.createVirtualDisplay(
            "DroidClaw",
            captureWidth, captureHeight, screenDensity,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader!!.surface, null, null
        )

        mediaProjection?.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                Log.i(TAG, "MediaProjection stopped")
                release()
            }
        }, null)

        isAvailable.value = true
        Log.i(TAG, "Screen capture initialized: ${captureWidth}x${captureHeight}")
    }

    fun capture(): ByteArray? {
        val reader = imageReader ?: return null
        val image = reader.acquireLatestImage() ?: return null
        return try {
            val planes = image.planes
            val buffer = planes[0].buffer
            val pixelStride = planes[0].pixelStride
            val rowStride = planes[0].rowStride
            val rowPadding = rowStride - pixelStride * image.width

            val bitmap = createBitmap(
                image.width + rowPadding / pixelStride,
                image.height,
                Bitmap.Config.ARGB_8888
            )
            bitmap.copyPixelsFromBuffer(buffer)

            val cropped = Bitmap.createBitmap(bitmap, 0, 0, image.width, image.height)
            if (cropped != bitmap) bitmap.recycle()

            if (isBlackFrame(cropped)) {
                cropped.recycle()
                Log.w(TAG, "Detected FLAG_SECURE (black frame)")
                return null
            }

            val stream = ByteArrayOutputStream()
            cropped.compress(Bitmap.CompressFormat.JPEG, 50, stream)
            cropped.recycle()
            stream.toByteArray()
        } finally {
            image.close()
        }
    }

    private fun isBlackFrame(bitmap: Bitmap): Boolean {
        val points = listOf(
            0 to 0,
            bitmap.width - 1 to 0,
            0 to bitmap.height - 1,
            bitmap.width - 1 to bitmap.height - 1,
            bitmap.width / 2 to bitmap.height / 2
        )
        return points.all { (x, y) -> bitmap[x, y] == android.graphics.Color.BLACK }
    }

    fun release() {
        virtualDisplay?.release()
        virtualDisplay = null
        imageReader?.close()
        imageReader = null
        mediaProjection?.stop()
        mediaProjection = null
        isAvailable.value = false
    }
}
