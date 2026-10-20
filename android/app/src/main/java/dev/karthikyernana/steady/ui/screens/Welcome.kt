package dev.karthikyernana.steady.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.dp
import dev.karthikyernana.steady.data.bool
import dev.karthikyernana.steady.net.ApiError
import dev.karthikyernana.steady.ui.*
import kotlinx.coroutines.launch

/** First run: sign in to the same account as the web app (everything syncs down), or start on this phone only. */
@Composable
fun Welcome(onDone: () -> Unit) {
    var mode by remember { mutableStateOf("start") } // start | account | local
    Column(Modifier.fillMaxSize().systemBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp)) {
        Spacer(Modifier.height(48.dp))
        Eyebrow("Steady")
        Spacer(Modifier.height(10.dp))
        Text("A calm place for your days.", style = Type.display, color = P.ink)
        Spacer(Modifier.height(10.dp))
        Text("Tasks, goals, money and thoughts. It learns how you work and reminds you at the right time.", style = Type.body, color = P.muted)
        Spacer(Modifier.height(32.dp))
        when (mode) {
            "start" -> {
                PrimaryButton("Sign in or create account", Modifier.fillMaxWidth()) { mode = "account" }
                Spacer(Modifier.height(10.dp))
                GhostButton("Use on this phone only", Modifier.fillMaxWidth()) { mode = "local" }
                Spacer(Modifier.height(14.dp))
                Text("With an account, everything syncs with the web app.", style = Type.small, color = P.muted)
            }
            "account" -> AccountForm(onDone = onDone, onBack = { mode = "start" })
            else -> LocalForm(onDone = onDone, onBack = { mode = "start" })
        }
    }
}

@Composable
private fun LocalForm(onDone: () -> Unit, onBack: () -> Unit) {
    val c = LocalCtx.current
    var name by remember { mutableStateOf("") }
    SField(name, { name = it }, "What should I call you?", testTag = "onb-name", ime = ImeAction.Done, onIme = {})
    Spacer(Modifier.height(14.dp))
    PrimaryButton("Start", Modifier.fillMaxWidth(), enabled = name.isNotBlank()) {
        c.app.store.setMeta("profile", "name" to name.trim())
        c.app.store.setLocal("onboarded", "1")
        onDone()
    }
    TextButton(onClick = onBack) { Text("Back", color = P.muted) }
}

@Composable
fun AccountForm(onDone: () -> Unit, onBack: (() -> Unit)?) {
    val c = LocalCtx.current
    val scope = rememberCoroutineScope()
    var step by remember { mutableStateOf("email") } // email | login | create
    var email by remember { mutableStateOf("") }
    var pw by remember { mutableStateOf("") }
    var pw2 by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }
    fun run(block: suspend () -> Unit) { if (busy) return; busy = true; err = null; scope.launch { try { block() } catch (e: ApiError) { err = e.message } catch (e: Exception) { err = e.message ?: "Something went wrong." } finally { busy = false } } }
    val validEmail = Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$").matches(email.trim())

    SField(email, { email = it; if (step != "email") step = "email" }, "Email", keyboard = KeyboardType.Email, ime = ImeAction.Next, testTag = "si-email")
    Spacer(Modifier.height(10.dp))
    when (step) {
        "email" -> PrimaryButton(if (busy) "Checking…" else "Continue", Modifier.fillMaxWidth(), enabled = validEmail && !busy) {
            run { val r = c.app.sync.check(email.trim().lowercase()); step = if (r.bool("exists") == true) "login" else "create" }
        }
        "login" -> {
            SField(pw, { pw = it }, "Password", password = true, testTag = "si-password", onIme = {})
            Spacer(Modifier.height(12.dp))
            PrimaryButton(if (busy) "Signing in…" else "Sign in", Modifier.fillMaxWidth(), enabled = pw.isNotEmpty() && !busy) {
                run { c.app.sync.logIn(email.trim().lowercase(), pw); c.app.store.setLocal("onboarded", "1"); onDone() }
            }
        }
        "create" -> {
            Text("New here. Create your account.", style = Type.small, color = P.muted)
            Spacer(Modifier.height(8.dp))
            SField(name, { name = it }, "Your name", ime = ImeAction.Next)
            Spacer(Modifier.height(8.dp))
            SField(pw, { pw = it }, "Password (8+ characters)", password = true, ime = ImeAction.Next)
            Spacer(Modifier.height(8.dp))
            SField(pw2, { pw2 = it }, "Confirm password", password = true)
            Spacer(Modifier.height(12.dp))
            val ok = pw.length >= 8 && pw == pw2 && !busy
            if (pw2.isNotEmpty() && pw != pw2) Text("Passwords don't match.", style = Type.small, color = P.danger)
            PrimaryButton(if (busy) "Creating…" else "Create account", Modifier.fillMaxWidth(), enabled = ok) {
                run {
                    c.app.sync.signUp(email.trim().lowercase(), pw, name.trim())
                    if (name.isNotBlank() && c.snap.profile["name"] == null) c.app.store.setMeta("profile", "name" to name.trim())
                    c.app.store.setLocal("onboarded", "1"); onDone()
                }
            }
        }
    }
    err?.let { Spacer(Modifier.height(10.dp)); Text(it, style = Type.small, color = P.danger) }
    if (onBack != null) TextButton(onClick = onBack) { Text("Back", color = P.muted) }
}
