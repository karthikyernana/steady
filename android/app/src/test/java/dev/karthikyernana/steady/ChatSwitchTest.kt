package dev.karthikyernana.steady

import dev.karthikyernana.steady.agent.ChatBackend
import dev.karthikyernana.steady.agent.ChatErrors
import dev.karthikyernana.steady.agent.ChatMessage
import dev.karthikyernana.steady.agent.ChatReply
import dev.karthikyernana.steady.agent.ChatSummary
import dev.karthikyernana.steady.net.ApiError
import dev.karthikyernana.steady.ui.screens.ChatState
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

/** A chat backend whose answers wait for a gate, so a test can switch chats while one is still answering. */
private class FakeChat : ChatBackend {
    val gates = mutableMapOf<String, CompletableDeferred<Unit>>()
    var failNext: ApiError? = null
    val stored = linkedMapOf<String, MutableList<ChatMessage>>()
    private var n = 0
    override suspend fun send(chatId: String?, message: String): ChatReply {
        gates[message]?.await()
        failNext?.let { failNext = null; throw it }
        val id = chatId ?: "chat-${++n}"; val k = ++n
        val u = ChatMessage("u$k", true, message, emptyList(), 0); val a = ChatMessage("a$k", false, "answer to $message", emptyList(), 0)
        stored.getOrPut(id) { mutableListOf() }.addAll(listOf(u, a))
        return ChatReply(id, stored[id]!!.first().text, u, a)
    }
    override suspend fun list() = stored.map { ChatSummary(it.key, it.value.first().text, it.value.last().text, 0L) }
    override suspend fun open(id: String) = (stored[id] ?: throw ApiError(404, "That chat is gone.")).let { ChatSummary(id, it.first().text, "", 0L) to it.toList() }
    override suspend fun delete(id: String) { stored.remove(id) ?: throw ApiError(404, "That chat is gone.") }
    override suspend fun rename(id: String, title: String) { throw ApiError(404, "not here yet") }
}

@OptIn(ExperimentalCoroutinesApi::class)
class ChatSwitchTest {
    @Test fun switchChatsWhileAnAnswerIsPending() = runTest {
        val api = FakeChat(); val toasts = mutableListOf<String>()
        val st = ChatState(api, null, null, this) { toasts += it }
        val slow = CompletableDeferred<Unit>(); api.gates["slow question"] = slow
        st.input = "slow question"; st.send(); advanceUntilIdle()
        val a = st.cur
        assertEquals("slow question", st.sending)
        // New works while it is answering, and the composer works there at the same time
        st.fresh()
        assertNotSame(a, st.cur); assertNull(st.sending); assertTrue(st.msgs.isEmpty())
        assertEquals(listOf(true), st.historyItems().filter { it.key == a.key }.map { it.pending })
        st.input = "fast question"; st.send(); advanceUntilIdle()
        val b = st.cur
        assertEquals(listOf("fast question", "answer to fast question"), b.msgs.map { it.text })
        assertTrue("another chat is busy: History shows it", st.othersBusy)
        // the slow answer lands in ITS chat, not the one on screen
        slow.complete(Unit); advanceUntilIdle()
        assertSame(b, st.cur)
        assertEquals(2, b.msgs.size)
        assertEquals(listOf("slow question", "answer to slow question"), a.msgs.map { it.text })
        assertTrue(a.unread); assertNull(a.pending)
        assertTrue(toasts.any { it.startsWith("Answer ready") })
        // going back to it: exactly one question and its answer, marked read
        st.open(a.id!!); advanceUntilIdle()
        assertSame(a, st.cur); assertFalse(a.unread)
        assertEquals(listOf("u2", "a2").size, st.msgs.size)
        assertEquals(st.msgs.map { it.id }.distinct().size, st.msgs.size)
        // drafts stay with their chat
        st.input = "half a thought"; st.open(b.id!!); assertEquals("", st.input); st.open(a.id!!); assertEquals("half a thought", st.input)
        // a brand-new chat (no id yet) answering in the background: its answer lands there, never in the chat on screen
        st.input = ""; st.fresh(); val gate = CompletableDeferred<Unit>(); api.gates["second slow"] = gate
        st.input = "second slow"; st.send(); advanceUntilIdle(); val d = st.cur
        st.open(b.id!!); advanceUntilIdle()
        assertTrue(st.historyItems().any { it.key == d.key && it.pending && it.id == null })
        gate.complete(Unit); advanceUntilIdle()
        assertEquals(listOf("second slow", "answer to second slow"), d.msgs.map { it.text }); assertNotNull(d.id)
        assertEquals(2, b.msgs.size); assertSame(b, st.cur)
        // a chat deleted while it was answering drops its answer quietly
        val g2 = CompletableDeferred<Unit>(); api.gates["follow-up"] = g2
        st.open(a.id!!); advanceUntilIdle(); st.input = "follow-up"; st.send(); advanceUntilIdle()
        st.delete(a.id!!); advanceUntilIdle()
        g2.complete(Unit); advanceUntilIdle()
        assertTrue(st.convs.none { it === a }); assertTrue(st.convs.none { c -> c.msgs.any { it.text == "follow-up" } })
    }

    @Test fun errorsAreCalmAndRetryable() = runTest {
        val api = FakeChat(); val st = ChatState(api, null, null, this) { }
        api.failNext = ApiError(502, "I could not reach a model right now. Try again in a minute. [groq 429: Rate limit reached for model openai/gpt-oss-120b]")
        st.input = "how is my streak?"; st.send(); advanceUntilIdle()
        assertEquals(ChatErrors.BUSY, st.error)
        assertFalse(st.error!!.contains("[") || st.error!!.contains("groq", true) || st.error!!.contains("429"))
        assertTrue(st.canRetry); assertEquals("how is my streak?", st.input)
        st.retry(); advanceUntilIdle()
        assertNull(st.error); assertEquals("", st.input); assertEquals(2, st.msgs.size)
    }

    @Test fun friendlyErrorRules() {
        assertEquals(ChatErrors.BUSY, ChatErrors.friendly(500, "TypeError: undefined").msg)
        assertEquals(ChatErrors.BUSY, ChatErrors.friendly(429, "Rate limit reached (mock)").msg)
        assertEquals("That's the daily limit for chat (60). It resets at midnight.", ChatErrors.friendly(429, "That's the daily limit for chat (60). It resets at midnight.").msg)
        assertFalse(ChatErrors.friendly(429, "That's the daily limit for chat (60). It resets at midnight.").retry)
        assertEquals("Keep it under 1000 characters.", ChatErrors.friendly(413, "Keep it under 1000 characters.").msg)
        assertTrue(ChatErrors.friendly(404, "gone").gone); assertTrue(ChatErrors.friendly(503, "Chat isn't set up on this Steady yet.").off)
        assertEquals("Busy. Try later.", ChatErrors.strip("Busy. [groq 429: x] Try later. [gemini"))
    }

    @Test fun renameStaysOnDeviceWhenServerCannot() = runTest {
        val api = FakeChat(); var saved: Map<String, String> = emptyMap()
        val st = ChatState(api, null, null, this, saveTitles = { saved = it }) { }
        st.input = "first"; st.send(); advanceUntilIdle()
        st.rename(st.chatId!!, "  My money chat  "); advanceUntilIdle()
        assertEquals("My money chat", st.title); assertEquals("My money chat", saved[st.chatId])
        st.loadList(); advanceUntilIdle()
        assertEquals("My money chat", st.historyItems().first().title)
    }
}
