package dev.karthikyernana.steady.data

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Encrypts small secrets (the sign-in session) before they touch disk. */
interface Secrets {
    fun seal(plain: String): String
    fun open(sealed: String): String?
}

/**
 * AES-256-GCM with a key that lives in the Android Keystore (hardware-backed where the phone has it). The key can't
 * be exported, so a copy of the app's database is useless off this device.
 */
class KeystoreSecrets(private val alias: String = "steady-session") : Secrets {
    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
        return gen.generateKey()
    }
    override fun seal(plain: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val ct = c.doFinal(plain.toByteArray(Charsets.UTF_8))
        return "v1:" + Base64.encodeToString(c.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP)
    }
    override fun open(sealed: String): String? = runCatching {
        val p = sealed.split(":"); require(p.size == 3 && p[0] == "v1")
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(p[1], Base64.NO_WRAP))) }
        String(c.doFinal(Base64.decode(p[2], Base64.NO_WRAP)), Charsets.UTF_8)
    }.getOrNull()   // key lost (e.g. restored to a new phone): treat as signed out
}
