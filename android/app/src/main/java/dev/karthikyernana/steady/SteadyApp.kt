package dev.karthikyernana.steady

import android.app.Application
import android.content.Context
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import dev.karthikyernana.steady.core.Dates
import dev.karthikyernana.steady.data.Store
import dev.karthikyernana.steady.data.Task
import dev.karthikyernana.steady.data.with
import dev.karthikyernana.steady.net.Api
import dev.karthikyernana.steady.reminders.Reminders
import dev.karthikyernana.steady.sync.Sync
import dev.karthikyernana.steady.sync.SyncWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.LocalDateTime

open class SteadyApp : Application() {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    lateinit var store: Store; private set
    lateinit var api: Api; private set
    lateinit var sync: Sync; private set
    @Volatile var foreground = false; private set
    private var reminderJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        store = Store.get(this)
        api = Api(store, secrets())
        sync = Sync(store, api, scope)
        Reminders.ensureChannel(this)
        store.onLocalChange = {
            if (foreground) sync.requestSync() else SyncWorker.enqueueOnce(this)
            rearmSoon()
        }
        // pulls from other devices also change reminders
        scope.launch { var last = -1L; store.snapshot.collect { if (it.version != last) { last = it.version; rearmSoon() } } }
        SyncWorker.schedulePeriodic(this)
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) { foreground = true; sync.startLive(); scope.launch { sync.checkSession() } }
            override fun onStop(owner: LifecycleOwner) {
                foreground = false; sync.stopLive()
                if (store.pendingCount() > 0) SyncWorker.enqueueOnce(this@SteadyApp)
            }
        })
    }

    /** Tests swap the Keystore (absent on the JVM) for a plain AES key. */
    protected open fun secrets(): dev.karthikyernana.steady.data.Secrets = dev.karthikyernana.steady.data.KeystoreSecrets()

    private fun rearmSoon() {
        reminderJob?.cancel()
        reminderJob = scope.launch { delay(400); Reminders.reconcile(this@SteadyApp, store.snapshot.value) }
    }

    /** Done / Snooze from a notification (or anywhere). Snooze = move the reminder 10 minutes from now. */
    fun taskAction(action: String, id: String, done: () -> Unit = {}) {
        scope.launch {
            try {
                val t = store.get("tasks", id)?.let(::Task) ?: return@launch
                if (action == "DONE") store.save("tasks", t.raw.with("status" to "done", "doneAt" to System.currentTimeMillis()))
                else if (action == "SNOOZE") {
                    val d = LocalDateTime.now(Dates.zone).plusMinutes(10)
                    store.save("tasks", t.raw.with("dueDate" to d.toLocalDate().toString(), "dueTime" to "%02d:%02d".format(d.hour, d.minute), "reminder" to true))
                }
                Reminders.reconcile(this@SteadyApp, store.snapshot.value)
                if (sync.signedIn) { if (foreground) sync.syncNow() else SyncWorker.enqueueOnce(this@SteadyApp) }
            } finally { done() }
        }
    }

    companion object {
        fun get(ctx: Context) = ctx.applicationContext as SteadyApp
        fun store(ctx: Context) = get(ctx).store
    }
}
