package dev.karthikyernana.steady.agent

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import java.io.File

/** Native mic capture: AAC in an MP4 container (audio/mp4), 16 kHz mono, which Sarvam Saaras accepts directly. */
class Recorder(private val ctx: Context) {
    private var rec: MediaRecorder? = null
    private var file: File? = null
    private var startedAt = 0L
    val isRecording get() = rec != null

    fun start() {
        stopQuietly()
        val f = File(ctx.cacheDir, "voice-${System.currentTimeMillis()}.m4a")
        val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(ctx) else @Suppress("DEPRECATION") MediaRecorder()
        r.setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
        r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        r.setAudioChannels(1)
        r.setAudioSamplingRate(16_000)
        r.setAudioEncodingBitRate(32_000)
        r.setMaxDuration(90_000)
        r.setOutputFile(f.absolutePath)
        r.prepare(); r.start()
        rec = r; file = f; startedAt = System.currentTimeMillis()
    }

    /** Stops and returns the audio, or null when the clip is too short to hold speech. */
    fun stop(): ByteArray? {
        val r = rec ?: return null
        val f = file
        rec = null; file = null
        val ok = runCatching { r.stop() }.isSuccess
        r.release()
        val bytes = if (ok && f != null && System.currentTimeMillis() - startedAt >= 500) f.readBytes() else null
        f?.delete()
        return bytes?.takeIf { it.size > 1000 }
    }

    fun level(): Float = runCatching { (rec?.maxAmplitude ?: 0) / 32767f }.getOrDefault(0f)

    fun stopQuietly() { rec?.let { runCatching { it.stop() }; it.release() }; rec = null; file?.delete(); file = null }
}
