package dev.karthikyernana.steady.ui.screens

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Sync
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import dev.karthikyernana.steady.BuildConfig
import dev.karthikyernana.steady.data.bool
import dev.karthikyernana.steady.data.int
import dev.karthikyernana.steady.data.str
import dev.karthikyernana.steady.net.ApiError
import dev.karthikyernana.steady.reminders.Reminders
import dev.karthikyernana.steady.ui.*
import kotlinx.coroutines.launch

@Composable
fun YouScreen(onClose: () -> Unit, onGuide: () -> Unit = {}) {
    val c = LocalCtx.current
    val ctx = LocalContext.current
    val s = c.snap
    val scope = rememberCoroutineScope()
    val st by c.app.sync.status.collectAsStateWithLifecycle()
    var name by remember { mutableStateOf(s.profile.str("name") ?: "") }
    var signingIn by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var devices by remember { mutableStateOf(false) }
    var changingPw by remember { mutableStateOf(false) }
    // permissions can change in system settings while we're away: re-read on resume
    var perms by remember { mutableIntStateOf(0) }
    val owner = LocalLifecycleOwner.current
    LaunchedEffect(owner) { owner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) { perms++ } }
    val canNotify = remember(perms) { Reminders.canNotify(ctx) }
    val canExact = remember(perms) { Reminders.canExact(ctx) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 18.dp, end = 18.dp, top = 6.dp, bottom = 60.dp).testTag("you"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        PageHead("YOU", "Settings, ", "kept simple")
        GhostButton("How Steady works", Modifier.fillMaxWidth().testTag("guide-open"), onClick = onGuide)

        SCard {
            CardTitle(Icons.Outlined.Sync, "Sync across devices")
            if (c.app.sync.signedIn) {
                Text(c.app.sync.account ?: "", style = Type.bodyM, color = P.ink, modifier = Modifier.testTag("acct-email"))
                Text(when (st.state) { dev.karthikyernana.steady.sync.Sync.State.ERROR, dev.karthikyernana.steady.sync.Sync.State.OFFLINE -> st.error ?: "Not synced"
                    else -> st.lastSyncedAt?.let { "Synced ${ago(it)}" } ?: "Syncing…" }, style = Type.small, color = P.muted)
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    GhostButton("Sync now") { scope.launch { if (c.app.sync.syncNow()) c.toast("Synced.", null) else c.toast(c.app.sync.status.value.error ?: "Couldn't sync.", null) } }
                    GhostButton("Sign out") { scope.launch { c.app.sync.signOut(); c.toast("Signed out. Your data stays on this phone.", null) } }
                }
                Spacer(Modifier.height(4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    GhostButton("Devices", Modifier.testTag("devices-btn")) { devices = true }
                    GhostButton("Change password") { changingPw = true }
                }
                TextButton(onClick = { deleting = true }) { Text("Delete account", color = P.danger, style = Type.label) }
            } else if (signingIn) AccountForm(onDone = { signingIn = false; c.toast("Signed in. Syncing your data.", null) }, onBack = { signingIn = false })
            else {
                Text(if (st.state == dev.karthikyernana.steady.sync.Sync.State.SIGNED_OUT) st.error ?: "Signed out." else "Sign in to sync with the web app and your other devices.", style = Type.body, color = P.ink2)
                Spacer(Modifier.height(10.dp))
                PrimaryButton("Sign in", Modifier.testTag("signin")) { signingIn = true }
            }
        }

        SCard {
            CardTitle(Icons.Outlined.Person, "About you")
            SField(name, { name = it }, "Name", onIme = { c.app.store.setMeta("profile", "name" to name.trim()) })
            if (name.trim() != (s.profile.str("name") ?: "")) TextButton(onClick = { c.app.store.setMeta("profile", "name" to name.trim()); c.toast("Saved.", null) }) { Text("Save name", color = P.accent) }
            TimeField("Wake up", s.profile.str("wake") ?: "07:00") { it?.let { v -> c.app.store.setMeta("profile", "wake" to v) } }
            TimeField("Sleep", s.profile.str("sleep") ?: "23:30") { it?.let { v -> c.app.store.setMeta("profile", "sleep" to v) } }
        }

        SCard {
            CardTitle(Icons.Outlined.Notifications, "Reminders")
            if (!canNotify) {
                Text("Notifications are off for Steady, so reminders can't reach you.", style = Type.body, color = P.danger)
                TextButton(onClick = { ctx.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)) }) { Text("Turn on notifications", color = P.accent) }
            } else if (!canExact && Build.VERSION.SDK_INT >= 31) {
                Text("Exact alarms are off, so reminders may arrive a few minutes late.", style = Type.body, color = P.warn)
                TextButton(onClick = { ctx.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${ctx.packageName}"))) }) { Text("Allow exact alarms", color = P.accent) }
            } else Text("On. Reminders ring on time, even with the app closed.", style = Type.body, color = P.ink2, modifier = Modifier.testTag("rem-ok"))
            val lead = s.settings.int("reminderLead") ?: 0
            var open by remember { mutableStateOf(false) }
            val leads = listOf(0 to "At the time", 5 to "5 min before", 10 to "10 min before", 15 to "15 min before", 30 to "30 min before")
            FieldRow("Remind me", leads.firstOrNull { it.first == lead }?.second ?: "$lead min before") { open = true }
            DropdownMenu(open, { open = false }) { leads.forEach { (v, l) -> DropdownMenuItem(text = { Text(l) }, onClick = { c.app.store.setMeta("settings", "reminderLead" to v); open = false }) } }
            SwitchRow("Remind by default when a task has a time", s.settings.bool("defaultReminder") != false) { c.app.store.setMeta("settings", "defaultReminder" to it) }
            TextButton(onClick = { Reminders.show(ctx, "test", "Steady", "Reminders work on this phone.", null, false) }, enabled = canNotify) { Text("Send a test notification", color = P.accent) }
        }

        SCard {
            CardTitle(Icons.Outlined.Palette, "Appearance")
            Segmented(listOf("system" to "System", "light" to "Light", "dark" to "Dark"), c.theme, c.setTheme, Modifier.fillMaxWidth())
        }

        // your data: the same backup file as the web app's Export / Import
        val exportL = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.CreateDocument("application/json")) { uri ->
            if (uri != null) runCatching { ctx.contentResolver.openOutputStream(uri)!!.use { it.write(c.app.store.exportJson().toByteArray()) } }
                .onSuccess { c.toast("Backup saved.", null) }.onFailure { c.toast("Couldn't save the backup.", null) }
        }
        val importL = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.OpenDocument()) { uri ->
            if (uri != null) runCatching { val t = ctx.contentResolver.openInputStream(uri)!!.use { it.readBytes().decodeToString() }; c.app.store.importJson(t) }
                .onSuccess { n -> c.toast(if (n > 0) "Imported $n records." else "Nothing new in that file.", null) }.onFailure { e -> c.toast("Import failed: ${e.message}", null) }
        }
        SCard {
            CardTitle(Icons.Outlined.Save, "Your data")
            Text("Import merges by record and keeps newer changes.", style = Type.small, color = P.muted)
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                GhostButton("Export JSON", Modifier.weight(1f).testTag("export")) { exportL.launch("steady-${dev.karthikyernana.steady.core.Dates.todayKey()}.json") }
                GhostButton("Import JSON", Modifier.weight(1f).testTag("import")) { importL.launch(arrayOf("application/json", "text/plain", "*/*")) }
            }
        }

        Text("Steady ${BuildConfig.VERSION_NAME} for Android", style = Type.small, color = P.muted, modifier = Modifier.padding(start = 4.dp))
    }

    if (devices) DevicesSheet { devices = false }
    if (changingPw) PasswordSheet { changingPw = false }
    if (deleting) {
        var pw by remember { mutableStateOf("") }; var err by remember { mutableStateOf<String?>(null) }
        AlertDialog(onDismissRequest = { deleting = false }, containerColor = P.surface,
            title = { Text("Delete your account?", style = Type.h3) },
            text = { Column { Text("This deletes your synced data on the server for good. This phone keeps its copy.", style = Type.body); Spacer(Modifier.height(10.dp)); SField(pw, { pw = it }, "Password", password = true); err?.let { Text(it, color = P.danger, style = Type.small) } } },
            confirmButton = { TextButton(onClick = { scope.launch { try { c.app.sync.deleteAccount(pw); deleting = false; c.toast("Account deleted.", null) } catch (e: ApiError) { err = e.message } } }, enabled = pw.isNotEmpty()) { Text("Delete", color = P.danger) } },
            dismissButton = { TextButton(onClick = { deleting = false }) { Text("Cancel") } })
    }
}

@Composable
fun CardTitle(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String) {
    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, modifier = Modifier.padding(bottom = 10.dp)) {
        Icon(icon, null, tint = P.ink2, modifier = Modifier.size(20.dp)); Spacer(Modifier.width(10.dp))
        Text(text, style = Type.bodyM.copy(fontSize = 17.sp), color = P.ink)
    }
}

@Composable
fun DevicesSheet(onClose: () -> Unit) {
    val c = LocalCtx.current
    val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf<List<dev.karthikyernana.steady.sync.Sync.Device>?>(null) }
    var err by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf<dev.karthikyernana.steady.sync.Sync.Device?>(null) }
    var confirmOthers by remember { mutableStateOf(false) }
    fun load() = scope.launch { try { list = c.app.sync.devices(); err = null } catch (e: ApiError) { err = e.message } }
    LaunchedEffect(Unit) { load() }
    SSheet(onClose, "Devices") {
        Text("Everywhere your account is signed in. Don't recognise one? Sign it out, then change your password.", style = Type.small, color = P.muted)
        Spacer(Modifier.height(12.dp))
        err?.let { Text(it, style = Type.small, color = P.danger) }
        if (list == null && err == null) CircularProgressIndicator(Modifier.size(22.dp), color = P.accent, strokeWidth = 2.dp)
        list?.forEach { d ->
            SCard(Modifier.padding(bottom = 8.dp).testTag("device-row"), pad = 14.dp) {
                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                            Text(d.name, style = Type.bodyM, color = P.ink, modifier = Modifier.weight(1f, fill = false))
                            if (d.current) { Spacer(Modifier.width(6.dp)); Pill("This device", color = P.accent, bg = P.accentSoft) }
                        }
                        Text(listOfNotNull(d.app.takeIf { it.isNotEmpty() && it != d.name }, d.place ?: "Unknown place").joinToString(" · "), style = Type.small, color = P.ink2)
                        Text("Active ${ago(d.lastSeenAt)} · signed in ${java.time.Instant.ofEpochMilli(d.createdAt).atZone(dev.karthikyernana.steady.core.Dates.zone).toLocalDate().let { dev.karthikyernana.steady.core.Dates.fmtDateKey(it.toString(), relative = false) }}" +
                            (if (d.firstPlace != null && d.firstPlace != d.place) " from ${d.firstPlace}" else ""), style = Type.small, color = P.muted)
                    }
                    TextButton(onClick = { confirm = d }) { Text("Sign out", color = P.danger, style = Type.label) }
                }
            }
        }
        if ((list?.size ?: 0) > 1) GhostButton("Sign out all other devices", Modifier.fillMaxWidth(), color = P.danger) { confirmOthers = true }
    }
    confirm?.let { d ->
        AlertDialog(onDismissRequest = { confirm = null }, containerColor = P.surface,
            title = { Text(if (d.current) "Sign out this phone?" else "Sign out ${d.name}?", style = Type.h3) },
            text = { Text(if (d.current) "Your data stays on this phone. It stops syncing until you sign in again." else "It stops syncing right away and needs your password to sign in again.", style = Type.body) },
            confirmButton = { TextButton(onClick = { val x = d; confirm = null; scope.launch {
                try { c.app.sync.signOutDevice(x); if (x.current) { onClose(); c.toast("Signed out on this phone.", null) } else { c.toast("Signed out. That device can no longer sync.", null); load() } }
                catch (e: ApiError) { err = e.message } } }) { Text("Sign out", color = P.danger) } },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Cancel") } })
    }
    if (confirmOthers) AlertDialog(onDismissRequest = { confirmOthers = false }, containerColor = P.surface,
        title = { Text("Sign out every other device?", style = Type.h3) }, text = { Text("They'll need your password to sign in again. This phone stays signed in.", style = Type.body) },
        confirmButton = { TextButton(onClick = { confirmOthers = false; scope.launch { try { val n = c.app.sync.signOutOtherDevices(); c.toast("Signed out $n device${if (n == 1) "" else "s"}.", null); load() } catch (e: ApiError) { err = e.message } } }) { Text("Sign out others", color = P.danger) } },
        dismissButton = { TextButton(onClick = { confirmOthers = false }) { Text("Cancel") } })
}

@Composable
fun PasswordSheet(onClose: () -> Unit) {
    val c = LocalCtx.current
    val scope = rememberCoroutineScope()
    var cur by remember { mutableStateOf("") }; var nw by remember { mutableStateOf("") }; var nw2 by remember { mutableStateOf("") }
    var err by remember { mutableStateOf<String?>(null) }; var busy by remember { mutableStateOf(false) }
    SSheet(onClose, "Change password") {
        SField(cur, { cur = it }, "Current password", password = true)
        Spacer(Modifier.height(8.dp)); SField(nw, { nw = it }, "New password (8+ characters)", password = true)
        Spacer(Modifier.height(8.dp)); SField(nw2, { nw2 = it }, "Confirm new password", password = true)
        if (nw2.isNotEmpty() && nw != nw2) Text("Passwords don't match.", style = Type.small, color = P.danger)
        err?.let { Text(it, style = Type.small, color = P.danger) }
        Spacer(Modifier.height(12.dp))
        Text("Changing it signs out every other device.", style = Type.small, color = P.muted)
        Spacer(Modifier.height(8.dp))
        PrimaryButton(if (busy) "Saving…" else "Change password", Modifier.fillMaxWidth(), enabled = !busy && cur.isNotEmpty() && nw.length >= 8 && nw == nw2) {
            busy = true; scope.launch {
                try { val n = c.app.sync.changePassword(cur, nw); onClose(); c.toast(if (n > 0) "Password changed. $n other device${if (n == 1) "" else "s"} signed out." else "Password changed.", null) }
                catch (e: ApiError) { err = e.message } finally { busy = false }
            }
        }
    }
}

fun ago(ts: Long): String {
    val s = (System.currentTimeMillis() - ts) / 1000
    return when { s < 45 -> "just now"; s < 3600 -> "${Math.round(s / 60.0)} min ago"; s < 86400 -> "${Math.round(s / 3600.0)} h ago"; else -> "${Math.round(s / 86400.0)} d ago" }
}
