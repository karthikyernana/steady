// Chat, pure client rules (no DOM), shared by js/ui/views/chat.js and unit-tested (tests/unit/chat-ui.test.mjs).
// The Android app mirrors these in agent/Chat.kt (ChatErrors, ChatOrder).

// A calm one-line message for a failed chat call. Raw provider text never reaches the screen: the server may append debug
// detail in [ … ] (e.g. "[groq 429: Rate limit reached …]"), which is stripped, and anything that still looks like a
// provider / HTTP error is replaced by the plain "busy" line. `retry`: whether Try again makes sense.
export const BUSY = 'Busy right now, try again in a moment.';
const RAW = /\b(groq|gemini|cloudflare|cerebras|openrouter|openai|llama|qwen|gpt|provider|model|api[ _-]?key|token|quota|rate.?limit|timeout|timed out|fetch|ECONN\w*|ETIMEDOUT|stack|undefined|null|json|http|status)\b|\d{3}\s*:|\{|\}|https?:/i;
export const stripDebug = s => String(s ?? '').replace(/\s*\[[^\]]*\]?/g, '').replace(/\s+/g, ' ').trim();
export function friendlyError(e, online = true) {
  const status = +e?.status || 0;
  const clean = stripDebug(e?.message);
  const safe = clean && clean.length <= 140 && !RAW.test(clean) ? clean : '';
  if (status === 0) return online ? { msg: 'Couldn’t reach Steady. Try again in a moment.', retry: true } : { msg: 'You’re offline. Your question is back in the box.', retry: true, offline: true };
  if (status === 429) return { msg: /limit|resting|midnight|tomorrow/i.test(safe) ? safe : BUSY, retry: !/limit|resting|midnight/i.test(safe) };
  if (status === 413) return { msg: safe || 'That’s a bit long. Keep it under 1000 characters.', retry: false };
  if (status === 404) return { msg: 'That chat is gone. Start a new one.', retry: false, gone: true };
  if (status === 503) return { msg: safe || 'Chat isn’t set up yet.', retry: false, off: true };
  if (status === 400) return { msg: safe || 'Try asking that another way.', retry: false };
  if (status === 401 || status === 403) return { msg: 'Sign in again to keep chatting.', retry: false };
  return { msg: BUSY, retry: true };              // 5xx, 502 "could not reach a model", anything unexpected
}

// History order: last activity first (a chat with a reply pending counts as active now); local pending chats that have
// no server id yet are listed too, so a question sent from a brand-new chat never disappears from History.
export function historyItems(serverList, convs, titles = {}) {
  const out = new Map();
  for (const ch of serverList || []) out.set(ch.id, { id: ch.id, key: null, title: titles[ch.id] || ch.title || 'Chat', preview: ch.preview || '', updatedAt: +ch.updatedAt || 0, pending: false, unread: false });
  for (const c of convs || []) {
    if (!c.id && !c.pending) continue;
    const prev = c.id ? out.get(c.id) : null;
    if (c.id && !prev && !c.pending && !c.msgs?.length) continue;
    const it = prev || { id: c.id || null, key: c.key, title: (c.id && titles[c.id]) || c.title || c.pending?.text || 'New chat', preview: '', updatedAt: 0, pending: false, unread: false };
    it.key = c.key; it.pending = !!c.pending; it.unread = !!c.unread;
    if (c.id && titles[c.id]) it.title = titles[c.id]; else if (!prev && c.title) it.title = c.title;
    it.updatedAt = Math.max(it.updatedAt, +c.updatedAt || 0);
    out.set(c.id || c.key, it);
  }
  return [...out.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

// Bottom-anchored thread: follow new content only while the reader is at (or near) the newest message.
export const NEAR_BOTTOM = 48;
export const atBottom = (scrollTop, scrollHeight, clientHeight, slack = NEAR_BOTTOM) => scrollHeight - scrollTop - clientHeight <= slack;
// Append messages without duplicating one the thread already has (a reply can land after the chat was reloaded).
export function appendUnique(msgs, ...add) {
  const ids = new Set(msgs.map(m => m.id));
  for (const m of add) if (m && !(m.id && ids.has(m.id))) { msgs.push(m); if (m.id) ids.add(m.id); }
  return msgs;
}
