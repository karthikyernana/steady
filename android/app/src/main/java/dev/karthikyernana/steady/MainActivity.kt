package dev.karthikyernana.steady

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import dev.karthikyernana.steady.ui.AppRoot

@OptIn(ExperimentalComposeUiApi::class)
class MainActivity : ComponentActivity() {
    /** Where a notification asked us to go ("today" | "checkin"); consumed by the UI. */
    var openRequest by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.auto(0x00000000, 0x00000000), navigationBarStyle = SystemBarStyle.auto(0x00000000, 0x00000000))
        openRequest = intent?.getStringExtra("open")
        // test tags double as resource ids, so the emulator end-to-end flow (Maestro) can address controls by id
        setContent { androidx.compose.foundation.layout.Box(androidx.compose.ui.Modifier.semantics { testTagsAsResourceId = true }) { AppRoot(this@MainActivity) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        openRequest = intent.getStringExtra("open")
    }
}
