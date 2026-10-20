package dev.karthikyernana.steady.reminders

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import dev.karthikyernana.steady.MainActivity
import dev.karthikyernana.steady.R
import dev.karthikyernana.steady.SteadyApp
import dev.karthikyernana.steady.core.Dates
import dev.karthikyernana.steady.data.Snapshot
import dev.karthikyernana.steady.data.Task
import dev.karthikyernana.steady.data.int
import dev.karthikyernana.steady.data.bool
import dev.karthikyernana.steady.data.str
import dev.karthikyernana.steady.sync.SyncWorker

/**
 * Reminders as native exact alarms. Every open task with a reminder and a time gets one alarm (setExactAndAllowWhileIdle,
 * so it fires in Doze and with the app closed); the evening check-in gets one per day. [reconcile] runs after every
 * change, on sync, on boot and when the time zone changes, and makes the scheduled set equal the wanted set.
 */
object Reminders {
    const val CHANNEL = "reminders"
    private const val HORIZON_MS = 14L * 86_400_000L
    private const val MAX = 120

    data class Want(val key: String, val at: Long, val title: String, val body: String, val taskId: String?, val high: Boolean)

    fun fireAt(t: Task, lead: Int): Long? {
        if (!t.reminder || t.dueTime == null || t.dueDate == null || !t.isOpen) return null
        val min = Dates.toMin(t.dueTime) ?: return null
        return runCatching { Dates.epochAt(t.dueDate!!, min - lead) }.getOrNull()
    }

    fun wanted(s: Snapshot, now: Long = System.currentTimeMillis()): List<Want> {
        val lead = s.settings.int("reminderLead") ?: 0
        val out = mutableListOf<Want>()
        for (t in s.tasks) {
            val at = fireAt(t, lead) ?: continue
            if (at <= now || at > now + HORIZON_MS) continue
            val body = listOfNotNull(t.durationMin?.let { "$it min" }, "due ${Dates.fmtTime(t.dueTime)}").joinToString(" · ")
            out += Want("st-${t.id}", at, t.title, body, t.id, t.priority == 3)
        }
        return out.sortedBy { it.at }.take(MAX)
    }

    fun idFor(key: String): Int { var h = -2128831035; for (c in key) { h = h xor c.code; h *= 16777619 }; return (h ushr 1).coerceAtLeast(1) }

    private fun pending(ctx: Context, w: Want?, key: String, flags: Int): PendingIntent? {
        val i = Intent(ctx, ReminderReceiver::class.java).setAction("dev.karthikyernana.steady.REMIND").putExtra("key", key)
        if (w != null) i.putExtra("title", w.title).putExtra("body", w.body).putExtra("taskId", w.taskId).putExtra("high", w.high).putExtra("at", w.at)
        return PendingIntent.getBroadcast(ctx, idFor(key), i, flags or PendingIntent.FLAG_IMMUTABLE)
    }

    fun canExact(ctx: Context): Boolean {
        val am = ctx.getSystemService(AlarmManager::class.java)
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
    }

    @Synchronized fun reconcile(ctx: Context, s: Snapshot) {
        val store = SteadyApp.store(ctx)
        val am = ctx.getSystemService(AlarmManager::class.java)
        val want = wanted(s)
        val prev = store.local("alarms").orEmpty().split("\n").filter { it.isNotBlank() }.associate { l -> l.substringBefore("\t") to l.substringAfter("\t") }
        val next = want.associate { it.key to "${it.at}|${it.title}|${it.body}" }
        for (key in prev.keys - next.keys) pending(ctx, null, key, PendingIntent.FLAG_NO_CREATE)?.let { am.cancel(it); it.cancel() }
        val exact = canExact(ctx)
        for (w in want) {
            val sig = next[w.key]
            if (prev[w.key] == sig && pending(ctx, null, w.key, PendingIntent.FLAG_NO_CREATE) != null) continue
            val pi = pending(ctx, w, w.key, PendingIntent.FLAG_UPDATE_CURRENT) ?: continue
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, w.at, pi)
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, w.at, pi)   // permission revoked: still fires, a little later
        }
        store.setLocal("alarms", next.entries.joinToString("\n") { "${it.key}\t${it.value}" })
    }

    fun ensureChannel(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Reminders", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Task reminders"; enableVibration(true); enableLights(true)
            })
    }

    fun canNotify(ctx: Context) = Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun show(ctx: Context, key: String, title: String, body: String, taskId: String?, high: Boolean) {
        if (!canNotify(ctx)) return
        ensureChannel(ctx)
        val id = idFor(key)
        val open = PendingIntent.getActivity(ctx, id, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra("open", "today"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val b = NotificationCompat.Builder(ctx, CHANNEL).setSmallIcon(R.drawable.ic_stat_steady).setContentTitle(title).setContentText(body)
            .setColor(0xFF3D6B52.toInt()).setPriority(NotificationCompat.PRIORITY_HIGH).setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true).setContentIntent(open)
        if (taskId != null) {
            fun act(a: String) = PendingIntent.getBroadcast(ctx, idFor("$key/$a"), Intent(ctx, ActionReceiver::class.java).setAction("dev.karthikyernana.steady.$a").putExtra("taskId", taskId).putExtra("key", key),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            b.addAction(0, "Done", act("DONE")).addAction(0, "Snooze 10 min", act("SNOOZE"))
            if (high) b.setPriority(NotificationCompat.PRIORITY_MAX)
        }
        try { NotificationManagerCompat.from(ctx).notify(id, b.build()) } catch (_: SecurityException) { }
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) {
        val key = i.getStringExtra("key") ?: return
        if (key.startsWith("st-checkin")) return          // retired in 1.3: an alarm armed by an older build stays silent
        val store = SteadyApp.store(ctx)
        val taskId = i.getStringExtra("taskId")
        // the task may have been finished or moved since the alarm was set: check the current record before buzzing
        if (taskId != null) {
            val t = store.get("tasks", taskId)?.let(::Task) ?: return
            val at = fireAt(t, store.meta("settings").int("reminderLead") ?: 0)
            if (at == null || kotlin.math.abs(at - i.getLongExtra("at", at)) > 60_000) return
        }
        Reminders.show(ctx, key, i.getStringExtra("title") ?: "Steady", i.getStringExtra("body") ?: "", taskId, i.getBooleanExtra("high", false))
    }
    private fun fireAt(t: Task, lead: Int) = Reminders.fireAt(t, lead)
}

/** Done / Snooze straight from the notification, without opening the app. */
class ActionReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) {
        val id = i.getStringExtra("taskId") ?: return
        val key = i.getStringExtra("key") ?: "st-$id"
        NotificationManagerCompat.from(ctx).cancel(Reminders.idFor(key))
        val pr = goAsync()
        SteadyApp.get(ctx).taskAction(i.action?.substringAfterLast('.') ?: return, id) { pr.finish() }
    }
}

class BootReceiver : BroadcastReceiver() {
    private val actions = setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED, Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED,
        "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED")
    override fun onReceive(ctx: Context, i: Intent) {
        if (i.action !in actions) return
        val s = SteadyApp.store(ctx).snapshot.value
        Reminders.reconcile(ctx, s)
        SyncWorker.enqueueOnce(ctx)
    }
}
