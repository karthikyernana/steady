package dev.karthikyernana.steady

import android.app.AlarmManager
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.karthikyernana.steady.core.Dates
import dev.karthikyernana.steady.data.*
import dev.karthikyernana.steady.reminders.ActionReceiver
import dev.karthikyernana.steady.reminders.BootReceiver
import dev.karthikyernana.steady.reminders.ReminderReceiver
import dev.karthikyernana.steady.reminders.Reminders
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.LocalDateTime

@RunWith(AndroidJUnit4::class)
@Config(application = TestApp::class, sdk = [34])
class ReminderTest {
    private lateinit var app: SteadyApp
    private lateinit var am: AlarmManager
    @Before fun setup() {
        app = ApplicationProvider.getApplicationContext()
        am = app.getSystemService(AlarmManager::class.java)
        shadowOf(app).grantPermissions(android.Manifest.permission.POST_NOTIFICATIONS)
    }

    private fun addTask(inMin: Long, reminder: Boolean = true, title: String = "Call amma"): JsonObject {
        val at = LocalDateTime.now(Dates.zone).plusMinutes(inMin)
        return app.store.save("tasks", buildJsonObject {
            put("id", uid()); put("title", title); put("priority", 3); put("dueDate", at.toLocalDate().toString()); put("dueTime", "%02d:%02d".format(at.hour, at.minute))
            put("durationMin", JsonNull); put("reminder", reminder); put("status", "open"); put("doneAt", JsonNull); put("goalId", JsonNull)
        })
    }
    private fun taskAlarms() = shadowOf(am).scheduledAlarms.filter { shadowOf(it.operation).savedIntent.getStringExtra("taskId") != null }

    @Test fun schedulesExactAlarmAndCancelsWhenDone() {
        app.store.setMeta("settings", "checkinNudge" to false)
        val t = addTask(60)
        Reminders.reconcile(app, app.store.snapshot.value)
        val alarms = taskAlarms()
        assertEquals(1, alarms.size)
        val want = Reminders.fireAt(Task(app.store.get("tasks", t.str("id")!!)!!), 0)!!
        assertEquals(want, alarms[0].triggerAtTime)
        assertEquals(AlarmManager.RTC_WAKEUP, alarms[0].type)
        assertTrue("exact + allow while idle", alarms[0].allowWhileIdle)

        // lead time moves it
        app.store.setMeta("settings", "reminderLead" to 10)
        Reminders.reconcile(app, app.store.snapshot.value)
        assertEquals(want - 10 * 60_000, taskAlarms().single().triggerAtTime)

        // done -> alarm gone
        app.store.save("tasks", app.store.get("tasks", t.str("id")!!)!!.with("status" to "done", "doneAt" to System.currentTimeMillis()))
        Reminders.reconcile(app, app.store.snapshot.value)
        assertEquals(0, taskAlarms().size)
    }

    @Test fun noAlarmWithoutReminderOrInPast() {
        app.store.setMeta("settings", "checkinNudge" to false)
        addTask(60, reminder = false); addTask(-30)
        Reminders.reconcile(app, app.store.snapshot.value)
        assertEquals(0, taskAlarms().size)
    }

    @Test fun firesNotificationWithDoneAndSnooze_andActionsWork() {
        app.store.setMeta("settings", "checkinNudge" to false)
        val t = addTask(60); val id = t.str("id")!!
        Reminders.reconcile(app, app.store.snapshot.value)
        val intent = shadowOf(taskAlarms().single().operation).savedIntent
        ReminderReceiver().onReceive(app, intent)
        val nm = app.getSystemService(NotificationManager::class.java)
        val n = shadowOf(nm).allNotifications.single()
        assertEquals("Call amma", n.extras.getString("android.title"))
        assertEquals(listOf("Done", "Snooze 10 min"), n.actions.map { it.title.toString() })
        assertEquals(Reminders.CHANNEL, n.channelId)

        // Snooze: due moves to now + 10 min, reminder stays on
        val snoozeIntent = shadowOf(n.actions[1].actionIntent).savedIntent
        ActionReceiver().onReceive(app, snoozeIntent)
        waitFor { Task(app.store.get("tasks", id)!!).dueTime != t.str("dueTime") }
        val snoozed = Task(app.store.get("tasks", id)!!)
        val exp = LocalDateTime.now(Dates.zone).plusMinutes(10)
        assertEquals("%02d:%02d".format(exp.hour, exp.minute), snoozed.dueTime)
        assertTrue(snoozed.reminder)
        assertEquals(0, shadowOf(nm).allNotifications.size)

        // Done
        ActionReceiver().onReceive(app, Intent(app, ActionReceiver::class.java).setAction("dev.karthikyernana.steady.DONE").putExtra("taskId", id))
        waitFor { Task(app.store.get("tasks", id)!!).isDone }
        assertNotNull(Task(app.store.get("tasks", id)!!).doneAt)
    }

    @Test fun staleAlarmDoesNotBuzz() {
        app.store.setMeta("settings", "checkinNudge" to false)
        val t = addTask(60); val id = t.str("id")!!
        Reminders.reconcile(app, app.store.snapshot.value)
        val intent = shadowOf(taskAlarms().single().operation).savedIntent
        app.store.save("tasks", app.store.get("tasks", id)!!.with("status" to "done"))   // finished on the laptop, alarm already armed
        ReminderReceiver().onReceive(app, intent)
        assertEquals(0, shadowOf(app.getSystemService(NotificationManager::class.java)).allNotifications.size)
    }

    @Test fun noCheckinNudgeAndBootReschedule() {
        app.store.setMeta("profile", "sleep" to "23:30")
        Reminders.reconcile(app, app.store.snapshot.value)
        // the evening check-in was retired: nothing may be scheduled for it
        assertTrue(shadowOf(am).scheduledAlarms.none { shadowOf(it.operation).savedIntent.getStringExtra("key")!!.startsWith("st-checkin") })
        // after reboot the OS drops alarms; the boot receiver re-arms them
        addTask(90, title = "After reboot")
        shadowOf(am).scheduledAlarms.toList().forEach { am.cancel(it.operation!!) }
        app.store.setLocal("alarms", null)
        BootReceiver().onReceive(app, Intent(Intent.ACTION_BOOT_COMPLETED))
        assertTrue(taskAlarms().any { shadowOf(it.operation).savedIntent.getStringExtra("title") == "After reboot" })
    }

    private fun waitFor(cond: () -> Boolean) { val end = System.currentTimeMillis() + 5000; while (!cond()) { check(System.currentTimeMillis() < end) { "timed out" }; org.robolectric.shadows.ShadowLooper.idleMainLooper(); Thread.sleep(20) } }
}
