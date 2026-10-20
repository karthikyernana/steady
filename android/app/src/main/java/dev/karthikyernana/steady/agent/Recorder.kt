package dev.karthikyernana.steady.agent

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import java.io.File

/**
 * Native mic capture: AAC in MP4 (audio/mp4), 16 kHz mono, which Sarvam Saaras accepts directly.
 * Sarvam takes at most ~30 s per file, so a long turn is recorded as pieces: the sheet calls [rotate] at a natural
 * pause after ~24 s (hard cut at 28 s) and every piece is transcribed and joined. A turn can last up to 2 minutes.
 */
class Recorder(private val ctx: Context) {
    private var rec: MediaRecorder? = null
    private var file: File? = null
    private var segStart = 0L
    private var turnStart = 0L
    private val pieces = mutableListOf<ByteArray>()
    val isRecording get() = rec != null
    /** ms since the current piece started / since the whole turn started. */
    val pieceMs get() = if (rec == null) 0L else System.currentTimeMillis() - segStart
    val turnMs get() = if (rec == null) 0L else System.currentTimeMillis() - turnStart

    fun start() {
        stopQuietly(); pieces.clear()
        turnStart = System.currentTimeMillis()
        open()
    }

    private fun open() {
        val f = File(ctx.cacheDir, "voice-${System.currentTimeMillis()}.m4a")
        val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(ctx) else @Suppress("DEPRECATION") MediaRecorder()
        r.setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
        r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        r.setAudioChannels(1)
        r.setAudioSamplingRate(16_000)
        r.setAudioEncodingBitRate(32_000)
        r.setMaxDuration(30_000) // safety net; the sheet rotates before this
        r.setOutputFile(f.absolutePath)
        r.prepare(); r.start()
        rec = r; file = f; segStart = System.currentTimeMillis()
    }

    private fun close(): ByteArray? {
        val r = rec ?: return null
        val f = file
        val long = System.currentTimeMillis() - segStart >= 500
        rec = null; file = null
        val ok = runCatching { r.stop() }.isSuccess
        r.release()
        val bytes = if (ok && f != null && long) f.readBytes() else null
        f?.delete()
        return bytes?.takeIf { it.size > 1000 }
    }

    /** Finish the current piece and keep recording into a new one (gap is a few ms). */
    fun rotate() { if (rec == null) return; close()?.let { pieces += it }; open() }

    /** Stops and returns every piece in order; empty when nothing usable was heard. */
    fun stop(): List<ByteArray> { close()?.let { pieces += it }; return pieces.toList().also { pieces.clear() } }

    fun level(): Float = runCatching { (rec?.maxAmplitude ?: 0) / 32767f }.getOrDefault(0f)

    fun stopQuietly() { rec?.let { runCatching { it.stop() }; it.release() }; rec = null; file?.delete(); file = null }
}
