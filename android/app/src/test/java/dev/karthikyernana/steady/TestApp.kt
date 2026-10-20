package dev.karthikyernana.steady

import dev.karthikyernana.steady.data.Sql
import dev.karthikyernana.steady.data.Store
import dev.karthikyernana.steady.net.Api
import java.sql.Connection
import java.sql.DriverManager

/** The same SQL the phone runs, on the JVM's SQLite (Robolectric has no native SQLite on Linux arm64). */
class JdbcSql(url: String = "jdbc:sqlite::memory:") : Sql {
    private val c: Connection = run { Class.forName("org.sqlite.JDBC"); DriverManager.getConnection(url) }
    private fun bind(sql: String, args: Array<Any?>) = c.prepareStatement(sql).apply { args.forEachIndexed { i, a -> setObject(i + 1, a) } }
    @Synchronized override fun query(sql: String, args: Array<Any?>): List<Array<String?>> = bind(sql, args).use { st ->
        st.executeQuery().use { rs -> val n = rs.metaData.columnCount; buildList { while (rs.next()) add(Array(n) { rs.getString(it + 1) }) } }
    }
    @Synchronized override fun exec(sql: String, args: Array<Any?>) { bind(sql, args).use { it.execute() } }
    @Synchronized override fun <T> tx(block: () -> T): T {
        c.autoCommit = false
        try { val r = block(); c.commit(); return r } catch (e: Throwable) { c.rollback(); throw e } finally { c.autoCommit = true }
    }
}

/** The real app, pointed at a local Steady server (STEADY_TEST_API) with WorkManager in test mode. */
/** Same AES-GCM sealing as the phone, with an in-memory key instead of the Keystore. */
class JvmSecrets : dev.karthikyernana.steady.data.Secrets {
    private val key = javax.crypto.KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    override fun seal(plain: String): String { val c = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding").apply { init(javax.crypto.Cipher.ENCRYPT_MODE, key) }
        return java.util.Base64.getEncoder().encodeToString(c.iv) + ":" + java.util.Base64.getEncoder().encodeToString(c.doFinal(plain.toByteArray())) }
    override fun open(sealed: String): String? = runCatching { val (iv, ct) = sealed.split(":")
        val c = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding").apply { init(javax.crypto.Cipher.DECRYPT_MODE, key, javax.crypto.spec.GCMParameterSpec(128, java.util.Base64.getDecoder().decode(iv))) }
        String(c.doFinal(java.util.Base64.getDecoder().decode(ct))) }.getOrNull()
}

class TestApp : SteadyApp() {
    override fun secrets(): dev.karthikyernana.steady.data.Secrets = JvmSecrets()
    override fun onCreate() {
        Store.resetForTests()
        Store.sqlFactory = { JdbcSql() }
        Api.baseOverride = System.getProperty("steady.api")?.takeIf { it.isNotEmpty() } ?: "http://127.0.0.1:8790/api/"
        dev.karthikyernana.steady.sync.SyncWorker.enabled = false
        super.onCreate()
    }
}
