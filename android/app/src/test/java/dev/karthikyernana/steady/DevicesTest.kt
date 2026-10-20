package dev.karthikyernana.steady

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** See every signed-in device from the phone and sign any of them out (the laptop, all others, or this phone). */
@RunWith(AndroidJUnit4::class)
@Config(application = TestApp::class, sdk = [34])
class DevicesTest {
    @Test fun listAndSignOutDevices() = runBlocking {
        val app: SteadyApp = ApplicationProvider.getApplicationContext()
        val email = "qa-android-dev-${System.currentTimeMillis()}@example.com"; val pw = "correct horse battery"
        app.sync.signUp(email, pw, "QA")
        val laptop = WebClient(); laptop.login(email, pw)
        var list = app.sync.devices()
        assertEquals(2, list.size)
        val me = list.single { it.current }
        assertTrue(me.name, me.name.startsWith("Android ·"))
        val lap = list.single { !it.current }
        assertEquals("Desktop", lap.name)
        app.sync.signOutDevice(lap)
        assertEquals(false, runCatching { laptop.call("GET", "auth/me") }.getOrNull()?.get("signedIn")?.toString()?.toBoolean())
        assertTrue(app.sync.signedIn)

        WebClient().login(email, pw); WebClient().login(email, pw)
        assertEquals(2, app.sync.signOutOtherDevices())
        assertEquals(1, app.sync.devices().size)

        val t = WebClient(); t.login(email, pw)
        assertEquals(1, app.sync.changePassword(pw, "brand new password"))
        assertTrue(app.sync.syncNow())                         // this phone keeps syncing

        list = app.sync.devices()
        app.sync.signOutDevice(list.single { it.current })     // sign this phone out from the list
        assertFalse(app.sync.signedIn)
        app.sync.logIn(email, "brand new password"); app.sync.deleteAccount("brand new password")
    }
}
