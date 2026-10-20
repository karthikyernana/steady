package dev.karthikyernana.steady.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import dev.karthikyernana.steady.SteadyApp
import dev.karthikyernana.steady.reminders.Reminders
import java.util.concurrent.TimeUnit

/**
 * Background sync: every ~15 minutes (Android's minimum) and once whenever a change needs to reach the server while the
 * app is closed (e.g. Done from a notification). After a pull, reminders are re-armed so a task added on the laptop
 * buzzes on the phone even if the app was never opened.
 */
class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val app = SteadyApp.get(applicationContext)
        if (!app.sync.signedIn) return Result.success()
        val ok = app.sync.syncNow()
        Reminders.reconcile(applicationContext, app.store.snapshot.value)
        return if (ok || runAttemptCount >= 3) Result.success() else Result.retry()
    }

    companion object {
        /** Off only in JVM tests (Robolectric on arm64 has no SQLite for WorkManager's own database). */
        @Volatile var enabled = true
        private val net = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        fun schedulePeriodic(ctx: Context) {
            if (!enabled) return
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("steady-sync", ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(net).build())
        }
        fun enqueueOnce(ctx: Context) {
            if (!enabled) return
            WorkManager.getInstance(ctx).enqueueUniqueWork("steady-sync-once", ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(net).build())
        }
    }
}
