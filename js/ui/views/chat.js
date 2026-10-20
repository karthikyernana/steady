// Chat: ask about your own data. One agent on the server reads tasks, goals, money and thoughts with read-only tools and
// answers with a few words plus cards (charts, lists, tables) computed from the real rows. Phase 1 is read-only.
//
// Chat is a PANEL over the app, not a page: it keeps its own DOM (built once, patched in place, so typing, focus and
// scroll survive every data change) and never replaces the tab underneath.
//  - Phones (< 960 px): a full-height sheet risen from the bottom. Every control is in the thumb zone: History / New /
//    Close in a row above the composer, the mic inside the composer (dictation only), History as a bottom sheet. The
//    header holds only the title (swipe it down to close).
//  - Desktop: a messenger-style panel docked in the bottom-right corner (resizable from its top-left corner, size kept
//    on this device), History shown inside the panel, the same History / New / Close row and composer at its bottom.
// The thread is bottom-anchored: a short chat sits right above the composer, newest at the bottom, and new messages
// scroll into view unless you scrolled up (then a "Latest" pill offers the way back).
// Several chats can be in flight at once: each question keeps running in ITS chat while you switch, start a new one or
// type elsewhere; its reply lands there (History shows it as typing, then as new).
import { I } from '../icons.js';
import { esc, greeting } from '../../core/util.js';
import { actions, toast, confirmSheet, openSheet } from '../ui.js';
import { openVoice } from '../voice.js';
import { renderCards } from '../cards.js';
import { revealHtml, plain, arrive, arriveCards } from '../chat-fx.js';

import * as motion from '../motion.js';
import { local, setLocal, meta } from '../../data/store.js';
import { chatBlocker, sendChat, listChats, getChat, deleteChat, renameChat, lastChat, rememberChat, getStarter } from '../../data/chat.js';
import { friendlyError, historyItems, atBottom, appendUnique } from '../../core/chat-ui.js';

// empty state: chart-worthy asks; "What did I write about…" fills the box so you finish the sentence
const SUGGEST = [
  { q: 'Spending by category this month' },
  { q: 'How am I doing on my goals?' },
  { q: 'What’s due this week?' },
  { q: 'What did I write about ', fill: true, label: 'What did I write about…?' },
];
const BLOCK = {
  signin: ['Chat needs your account', 'Chat reads your synced tasks, goals, money and thoughts, so it works once you sign in. Everything else works without it.', '<a class="btn primary sm" href="#/you" data-act="chat-signin" data-testid="chat-signin">Sign in</a>'],
  offline: ['You’re offline', 'Chat needs a connection to read your data. Everything else in Steady keeps working, and chat is here when you’re back online.', ''],
  off: ['Chat isn’t set up yet', 'This Steady has no chat model configured. Everything else works as usual.', ''],
};
const wideMq = matchMedia('(min-width: 960px)');

// ---------------------------------------------------------------- state: one conversation per chat, keyed locally
// conv: { key, id (server id once known), title, msgs, pending: { text, at } | null, err: { msg, retry, text } | null,
//         loaded, loading, unread, draft (what was typed here), scroll (px from the bottom when you left it), updatedAt }
const S = { convs: new Map(), cur: null, list: null, listing: false, off: false, blocker: null, open: false, hist: false, seq: 0, stick: false, rendered: new Map(), sig: '', starter: null, starting: false };
let histSheet = null, panel = null;
const newConv = (o = {}) => { const c = { key: `c${++S.seq}`, id: null, title: null, msgs: [], pending: null, err: null, loaded: true, loading: false, unread: false, draft: '', scroll: null, follow: true, updatedAt: 0, ...o }; S.convs.set(c.key, c); return c; };
const cv = () => S.convs.get(S.cur) || (S.cur = newConv().key, S.convs.get(S.cur));
const byId = id => [...S.convs.values()].find(c => c.id === id);
const titles = () => local('chatTitles', {}) || {};
const titleOf = c => (c.id && titles()[c.id]) || c.title;
window.__steadyChat = {           // test hook
  state: () => { const c = cv(); return { chat: c.id ? { id: c.id, title: titleOf(c) } : null, msgs: c.msgs, sending: c.pending, err: c.err, opening: c.loading ? c.id : null, list: S.list, open: S.open,
    convs: [...S.convs.values()].map(x => ({ key: x.key, id: x.id, title: titleOf(x), n: x.msgs.length, pending: !!x.pending, unread: x.unread, err: x.err?.msg || null })), cur: S.cur }; },
};

addEventListener('online', () => { if (S.open) paint(); });
addEventListener('offline', () => { if (S.open) paint(); });
wideMq.addEventListener?.('change', () => { histSheet?.close(); S.hist = false; if (panel) { applySize(); modality(); paint(true); } });

async function loadList() {
  if (S.listing) return; S.listing = true;
  try { S.list = (await listChats()).chats || []; } catch { S.list = S.list || []; }
  S.listing = false; paintHistory();
}

const time = ms => { if (!ms) return ''; const d = new Date(ms), now = new Date(); const same = d.toDateString() === now.toDateString();
  return same ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' }); };
// a quiet time line above a message when the chat starts or after a pause of 15+ minutes
const stamp = ms => { if (!ms) return ''; const d = new Date(ms), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = d.toDateString() === now.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day} · ${t}`; };
const GAP = 15 * 60e3;
// Steady's mark beside its answers (the app icon, small)
const MARK = '<svg viewBox="0 0 64 64" aria-hidden="true" class="mark"><rect width="64" height="64" rx="18" class="mark-bg"/><path d="M16 40c6-9 11-9 16 0s10 9 16 0" class="mark-wave"/><circle cx="32" cy="22" r="4.5" class="mark-dot"/></svg>';
const avatar = () => `<span class="cm-av" aria-hidden="true">${MARK}</span>`;

// Chips under the latest answer: the server's suggestions (1.6); an older server sends none, so a few follow-ups are
// offered from what the answer was about.
const FOLLOW = { query_money: ['Compare with last week', 'Biggest category this month?'], query_tasks: ['What’s due tomorrow?', 'What did I finish this week?'],
  query_goals: ['Which goal is behind?'], query_thoughts: ['What else did I write lately?'], search_thoughts: ['What else did I write lately?'], get_insights_summary: ['When am I most productive?'] };
function chipsFor(m, asked) {
  if (Array.isArray(m.suggestions)) return m.suggestions.filter(x => typeof x === 'string' && x.trim()).slice(0, 3);
  const out = [];
  for (const c of m.cards || []) for (const q of FOLLOW[c.query?.tool] || []) if (!out.includes(q) && q.toLowerCase() !== String(asked || '').toLowerCase()) out.push(q);
  return out.slice(0, 3);
}
const chips = qs => (qs.length ? `<div class="chat-chips" role="group" aria-label="Suggested questions" data-testid="chat-chips">${qs.map(q => `<button type="button" class="chip-btn" data-act="chat-suggest" data-q="${esc(q)}" data-testid="chat-chip">${esc(q)}</button>`).join('')}</div>` : '');

const hash = str => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
function message(m, fresh, extra = '') {
  const k = `${esc(m.id || '')}" data-sig="${hash(`${m.role}|${m.text}|${JSON.stringify(m.cards || [])}|${extra}`)}`, nw = fresh ? ' cm-new' : '';
  if (m.role === 'user') return `<div class="cm cm-user${nw}" data-k="m-${k}" data-testid="chat-msg-user"><div class="cm-bubble">${plain(m.text)}</div></div>`;
  const r = revealHtml(m.text, fresh);
  return `<div class="cm cm-agent${nw}${fresh && r.ms ? ' cm-reveal' : ''}" data-k="m-${k}" data-testid="chat-msg-agent" data-reveal="${r.ms}">${avatar()}<div class="cm-main">
    ${m.text ? `<div class="cm-text">${r.html}</div>` : ''}
    ${m.cards?.length ? `<div class="cm-cards" data-testid="chat-cards">${renderCards(m.cards)}</div>` : ''}${extra}</div></div>`;
}
const waiting = () => `<div class="cm cm-agent cm-wait" data-k="m-wait" role="status" data-testid="chat-wait">${avatar()}<div class="cm-typing" data-testid="chat-typing"><span class="cm-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="sr-only">Steady is looking at your data…</span></div></div>`;

// ---------------------------------------------------------------- empty state: a greeting, today's headline, starter chips
// The headline and chips come from GET agent/chat/starter (no model call). Without it (older server, offline, an error)
// the plain greeting and the built-in chart-worthy asks show instead.
const STARTER_TTL = 5 * 60e3;
async function loadStarter() {
  if (S.starting || (S.starter && Date.now() - S.starter.at < STARTER_TTL)) return;
  S.starting = true;
  try { const r = await getStarter(); S.starter = { at: Date.now(), text: String(r?.text || ''), cards: Array.isArray(r?.cards) ? r.cards.slice(0, 2) : [], suggestions: Array.isArray(r?.suggestions) ? r.suggestions.filter(x => typeof x === 'string' && x.trim()).slice(0, 4) : [] }; }
  catch (e) { if (e?.status !== 404) console.warn('[chat] starter failed', e?.status, e?.message); S.starter = { at: Date.now(), failed: true, text: '', cards: [], suggestions: [] }; }
  S.starting = false;
  if (S.open) paint();
}
function emptyState() {
  const name = (meta('profile') || {}).name, st = S.starter;
  const qs = st?.suggestions?.length ? st.suggestions.slice(0, 3).map(q => ({ q })) : SUGGEST.filter(x => !x.fill);
  const all = [...qs, SUGGEST.find(x => x.fill)];
  const head = st?.cards?.length || st?.text ? `<div class="chat-starter" data-testid="chat-starter">${st.text ? `<p class="chat-starter-line">${esc(st.text)}</p>` : ''}${st.cards?.length ? `<div class="cm-cards">${renderCards(st.cards)}</div>` : ''}</div>` : '';
  return `<section class="chat-empty" data-testid="chat-empty"><div class="chat-hello">${avatar()}<div><h2 class="chat-hello-h">${esc(greeting())}${name ? `, ${esc(String(name).split(' ')[0])}` : ''}.</h2>
      <p class="muted">Ask about your tasks, goals, money and thoughts. Answers come from your own data, with charts where they help.</p></div></div>
    ${head}
    <div class="chat-suggest chat-chips" data-testid="chat-starter-chips">${all.map(s => `<button type="button" class="chip-btn" data-act="chat-suggest" data-q="${esc(s.q)}"${s.fill ? ' data-fill="1"' : ''}>${esc(s.label || s.q)}</button>`).join('')}</div>
    <p class="hint">Chat can read, not change. To add or edit, hold the Ask button on any tab and say it, or use Today.</p></section>`;
}

// ---------------------------------------------------------------- history (phones: a bottom sheet; desktop: inside the panel)
function historyList() {
  if (S.blocker === 'signin') return '<p class="muted small chat-hist-empty">Your chats show up here once you sign in.</p>';
  const items = historyItems(S.list, [...S.convs.values()].map(c => ({ ...c, title: titleOf(c) })), titles());
  if (S.list === null && !items.length) return '<p class="muted small chat-hist-empty">Loading…</p>';
  if (!items.length) return '<p class="muted small chat-hist-empty">Your chats will show up here.</p>';
  const curC = cv();
  return `<ul class="chat-hist-list" data-testid="chat-history">${items.map(ch => {
    const on = ch.key ? ch.key === curC.key : ch.id === curC.id;
    const ref = ch.id ? `data-id="${esc(ch.id)}"` : `data-key="${esc(ch.key)}"`;
    const sub = ch.pending ? '<span class="chi-typing" data-testid="chat-hist-pending"><span class="cm-dots" aria-hidden="true"><i></i><i></i><i></i></span>Answering…</span>'
      : `${esc(time(ch.updatedAt))}${ch.preview ? ` · ${esc(ch.preview)}` : ''}`;
    return `<li class="${on ? 'on' : ''}${ch.unread ? ' unread' : ''}" data-k="h-${esc(ch.id || ch.key)}">
        <button type="button" class="chat-hist-item" data-act="chat-open" ${ref} aria-current="${on}"><span class="chi-title">${ch.unread ? '<i class="chi-dot" aria-label="New reply"></i>' : ''}${esc(ch.title)}</span>
          <span class="chi-sub">${sub}</span></button>
        ${ch.id ? `<button type="button" class="icon-btn chi-ren" data-act="chat-rename" data-id="${esc(ch.id)}" aria-label="Rename “${esc(ch.title)}”" title="Rename">${I.edit}</button>
        <button type="button" class="icon-btn chi-del" data-act="chat-del" data-id="${esc(ch.id)}" aria-label="Delete “${esc(ch.title)}”" title="Delete">${I.trash}</button>` : ''}</li>`; }).join('')}</ul>`;
}
function openHistory() {
  if (!S.blocker) loadList();
  if (wideMq.matches) { S.hist = !S.hist; paint(); return; }
  if (histSheet) return;
  histSheet = openSheet({ title: 'History', cls: 'chat-hist-sheet', body: `<div class="chat-hist-body" data-testid="chat-hist-sheet">${historyList()}</div>` });
  histSheet.onClose = () => { histSheet = null; panel?.querySelector('[data-testid=chat-hist-btn]')?.setAttribute('aria-expanded', 'false'); };
  panel?.querySelector('[data-testid=chat-hist-btn]')?.setAttribute('aria-expanded', 'true');
}
function paintHistory() {
  const el = histSheet?.el.querySelector('.chat-hist-body'); if (el) el.innerHTML = historyList();
  const pane = panel?.querySelector('.chat-hist-pane-body'); if (pane && S.hist) pane.innerHTML = historyList();
  // a reply waiting in another chat shows on the History button too
  const other = [...S.convs.values()].some(c => c.key !== S.cur && (c.pending || c.unread));
  panel?.querySelector('[data-testid=chat-hist-btn]')?.classList.toggle('has-news', other);
}

// ---------------------------------------------------------------- the panel
function skeleton() {
  return `<div class="chat-resize" data-testid="chat-resize" aria-hidden="true" title="Drag to resize"></div>
    <header class="chat-head" data-testid="chat-head"><span class="chat-grab" aria-hidden="true"></span>
      <span class="chat-head-mark" aria-hidden="true">${MARK}</span>
      <div class="chat-head-text"><span class="chat-brand">Steady</span><h1 class="chat-title" data-testid="chat-title" id="chat-title"></h1></div>
      <div class="chat-head-actions" role="toolbar" aria-label="Chat">
        <button type="button" class="icon-btn chat-hist-btn" data-act="chat-hist" aria-haspopup="dialog" aria-expanded="false" aria-label="History" title="History" data-testid="chat-hist-btn">${I.history}</button>
        <button type="button" class="icon-btn chat-new-btn" data-act="chat-new" aria-label="New chat" title="New chat" data-testid="chat-new">${I.plus}</button>
        <button type="button" class="icon-btn chat-close" data-act="chat-close" data-testid="chat-close" aria-label="Close chat" title="Close (Esc)">${I.close}</button>
      </div></header>
    <div class="chat-body">
      <div class="chat-scroll" data-testid="chat-main" tabindex="-1"><div class="chat-stack">
        <div class="chat-top"></div><div class="chat-thread" data-testid="chat-thread" aria-live="polite"></div></div></div>
      <button type="button" class="chat-jump" data-act="chat-jump" data-testid="chat-jump" hidden>${I.down}<span>Latest</span></button>
      <section class="chat-hist-pane" data-testid="chat-hist-pane" aria-label="Chat history" hidden><div class="chat-hist-pane-head"><span class="eyebrow">History</span></div><div class="chat-hist-pane-body"></div></section>
    </div>
    <div class="chat-dock" data-testid="chat-dock">
      <form class="chat-composer" id="chat-form" data-testid="chat-composer" autocomplete="off">
        <textarea id="chat-input" rows="1" maxlength="1000" aria-label="Ask about your data" placeholder="Ask about your data…" enterkeyhint="send"></textarea>
        <button type="button" class="chat-mic" data-act="chat-mic" aria-label="Dictate your question" title="Dictate (V)" data-testid="chat-mic">${I.mic}</button>
        <button type="submit" class="chat-send" aria-label="Send" data-testid="chat-send">${I.send}</button></form>
    </div>`;
}
function ensurePanel() {
  if (panel && document.body.contains(panel)) return panel;
  panel = document.createElement('section');
  panel.id = 'chat-panel'; panel.className = 'chat-panel'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-labelledby', 'chat-title'); panel.dataset.testid = 'chat-panel';
  panel.innerHTML = skeleton();
  document.body.appendChild(panel);
  const form = panel.querySelector('#chat-form'), ta = input();
  grow(ta);
  ta.addEventListener('input', () => { grow(ta); cv().draft = ta.value; syncSend(); });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener('submit', e => { e.preventDefault(); send(ta.value); });
  const sc = scroller();
  // following: the thread keeps the newest message in view until you scroll UP yourself (our own scrolls only go down)
  let lastTop = 0;
  sc.addEventListener('scroll', () => {
    const c = cv(), d = sc.scrollHeight - sc.scrollTop - sc.clientHeight; c.scroll = d;
    if (atBottom(sc.scrollTop, sc.scrollHeight, sc.clientHeight)) { c.follow = true; jump(false); }
    else { if (sc.scrollTop < lastTop - 2) c.follow = false; if (!c.follow && d > 200) jump(true); }
    lastTop = sc.scrollTop;
  }, { passive: true });
  // content that grows after it is drawn (fonts, charts, the textarea growing) keeps the newest message in view
  // (and so does the scroller shrinking when the keyboard opens or the box grows)
  if (window.ResizeObserver) { const ro = new ResizeObserver(() => { const c = cv(); if (c.follow && S.open) { sc.scrollTop = sc.scrollHeight; lastTop = sc.scrollTop; } }); ro.observe(panel.querySelector('.chat-stack')); ro.observe(sc); }
  dragToClose(panel); resizable(panel); applySize();
  return panel;
}
const input = () => panel?.querySelector('#chat-input');
const scroller = () => panel?.querySelector('.chat-scroll');
const grow = ta => { if (!ta) return; ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight + 2, 160)}px`; };
const jump = show => { const j = panel?.querySelector('.chat-jump'); if (j && j.hidden === show) j.hidden = !show; };
function syncSend() {
  const c = cv(), ta = input(), off = !!S.blocker;
  const btn = panel?.querySelector('.chat-send'); if (btn) btn.disabled = off || !!c.pending || !ta?.value.trim();
}

/** Open or close the panel (app.js owns when; this owns how). */
export function setChatOpen(open, { focus = true } = {}) {
  ensurePanel();
  if (open === S.open) { if (open) paint(); return; }
  S.open = open;
  document.documentElement.classList.toggle('chat-open', open);
  const hadFocus = panel.contains(document.activeElement);
  modality();
  const ease = 'cubic-bezier(.2,.8,.2,1)', wide = wideMq.matches;
  if (open) {
    panel.hidden = false; panel.classList.remove('closing');
    paint(true);
    if (!motion.calm()) panel.animate(wide ? [{ transform: 'translate3d(0, 24px, 0) scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }] : [{ transform: 'translate3d(0, 100%, 0)' }, { transform: 'none' }],
      { duration: wide ? 240 : 340, easing: ease });
    if (focus && wide) setTimeout(() => input()?.focus({ preventScroll: true }), 60);
  } else {
    histSheet?.close(); S.hist = false; input()?.blur();
    if (hadFocus) setTimeout(() => (document.getElementById('ask-fab') || document.querySelector('.side [data-testid=chat-btn]'))?.focus({ preventScroll: true }), 0);
    const done = () => { if (!S.open) { panel.hidden = true; panel.classList.remove('closing'); panel.style.transform = ''; } };
    if (motion.calm()) { done(); return; }
    panel.classList.add('closing');
    const from = panel.style.transform || 'none';
    panel.animate(wide ? [{ transform: 'none', opacity: 1 }, { transform: 'translate3d(0, 24px, 0) scale(.96)', opacity: 0 }] : [{ transform: from }, { transform: 'translate3d(0, 100%, 0)' }],
      { duration: wide ? 180 : 240, easing: 'cubic-bezier(.4,0,.8,.4)', fill: 'forwards' }).finished.then(a => { done(); panel.getAnimations().forEach(x => x.cancel()); }).catch(done);
  }
}
export const chatIsOpen = () => S.open;
/** Esc inside Chat closes what is on top first (the desktop History pane); returns true when it did. */
export function chatEscape() { if (S.open && S.hist && wideMq.matches) { S.hist = false; paint(); panel.querySelector('[data-testid=chat-hist-btn]')?.focus(); return true; } return false; }
// phones: the sheet is modal (the app underneath is inert, so focus and screen readers stay in Chat); desktop: it is not
function modality() {
  const modal = S.open && !wideMq.matches, app = document.getElementById('app');
  panel?.setAttribute('aria-modal', String(modal));
  if (app) app.inert = modal;
}
/** app.js calls this on every render while Chat is open (sign-in, connection and data changes). */
export function paintChat() { if (S.open) paint(); }

// Keyed patch: a message whose markup did not change keeps its DOM (its cards and charts are not parsed and drawn again),
// so a new answer costs only its own nodes. Fresh messages always get new nodes (and their entrance).
const drawn = new WeakMap();
function patchThread(th, parts, reset) {
  if (reset) { th.innerHTML = parts.join(''); [...th.children].forEach((n, i) => drawn.set(n, parts[i])); return [...th.children]; }
  const made = [];
  const old = new Map([...th.children].map(n => [n.dataset.k, n]));
  const tpl = document.createElement('template');
  let prev = null;
  for (const html of parts) {
    const k = /data-k="([^"]*)"/.exec(html)?.[1], sig = /data-sig="([^"]*)"/.exec(html)?.[1];
    let n = k != null ? old.get(k) : null;
    if (n && (sig ? n.dataset.sig === sig : drawn.get(n) === html)) old.delete(k);
    else { tpl.innerHTML = html; n = tpl.content.firstElementChild; drawn.set(n, html); made.push(n); }
    if ((prev ? prev.nextElementSibling : th.firstElementChild) !== n) th.insertBefore(n, prev ? prev.nextElementSibling : th.firstElementChild);
    prev = n;
  }
  if (prev) while (prev.nextElementSibling) prev.nextElementSibling.remove(); else th.textContent = '';
  return made;
}
function paint(force = false) {
  if (!panel) return;
  S.blocker = S.off ? 'off' : chatBlocker();
  if (!S.blocker && S.list === null && !S.listing) loadList();
  const c = cv(), off = !!S.blocker, wide = wideMq.matches;
  const offlineCopy = S.blocker === 'offline' && !c.msgs.length ? lastChat() : null;
  const msgs = offlineCopy ? offlineCopy.messages || [] : c.msgs;
  const title = offlineCopy ? offlineCopy.chat?.title : titleOf(c) || c.pending?.text;     // a new chat is named by its question at once
  const tEl = panel.querySelector('.chat-title'), tHtml = title ? esc(title) : 'New chat';
  if (tEl.innerHTML !== tHtml) tEl.innerHTML = tHtml;
  // top: blocked note / offline copy / empty state
  const blocked = S.blocker ? BLOCK[S.blocker] : null;
  let top = '';
  if (blocked) top += `<section class="card soft chat-note" data-testid="chat-blocked"><h2 class="card-title">${esc(blocked[0])}</h2><p class="muted">${esc(blocked[1])}</p>${blocked[2] ? `<div class="row gap mt">${blocked[2]}</div>` : ''}</section>`;
  if (offlineCopy && msgs.length) top += '<p class="muted small chat-offline-copy">Your last chat, as it was when you saw it.</p>';
  const isEmpty = !msgs.length && !c.pending && !blocked && !c.loading && !c.err;
  if (isEmpty) top += emptyState();
  if (c.loading && !c.loaded) top += '<div class="chat-loading" role="status" data-testid="chat-loading"><span class="vx-spin" aria-hidden="true"></span><span>Opening that chat…</span></div>';
  const topEl = panel.querySelector('.chat-top');
  if (topEl.dataset.sig !== top) { const was = topEl.dataset.starter; topEl.innerHTML = top; topEl.dataset.sig = top; topEl.dataset.starter = S.starter?.at || '';
    if (isEmpty && S.starter?.at && String(S.starter.at) !== was) arriveCards(topEl.querySelector('.chat-starter')); }
  if (isEmpty && !S.blocker) loadStarter();
  // thread: rebuilt only when it changed, and only messages not drawn before animate in
  const sig = `${c.key}|${msgs.map(m => m.id).join(',')}|${c.pending ? `p:${c.pending.text}` : ''}|${c.err ? `e:${c.err.msg}` : ''}|${offlineCopy ? 'off' : ''}|${msgs.length && c.loadedAt ? c.loadedAt : ''}`;
  const sc = scroller(), switched = panel.dataset.cur !== c.key;
  if (sig !== S.sig || force) {
    const seen = S.rendered.get(c.key) || new Set(), first = !seen.size;
    const parts = []; let prevAt = 0;
    const lastAgent = c.pending || c.err || offlineCopy ? -1 : msgs.map(m => m.role).lastIndexOf('assistant');
    msgs.forEach((m, i) => {
      const at = m.createdAt || 0;
      if (at && (!prevAt || at - prevAt > GAP)) parts.push(`<div class="cm-time" data-k="t-${esc(m.id || i)}">${esc(stamp(at))}</div>`);
      if (at) prevAt = at;
      const asked = msgs[i - 1]?.role === 'user' ? msgs[i - 1].text : '';
      parts.push(message(m, !first && !switched && !seen.has(m.id), i === lastAgent ? chips(chipsFor(m, asked)) : ''));
    });
    msgs.forEach(m => seen.add(m.id)); S.rendered.set(c.key, seen);
    if (c.pending) {
      if (!prevAt || c.pending.at - prevAt > GAP) parts.push(`<div class="cm-time" data-k="t-pending">${esc(stamp(c.pending.at))}</div>`);
      parts.push(message({ role: 'user', id: 'pending', text: c.pending.text }, !seen.has('pending:' + c.pending.at)), waiting());
      seen.add('pending:' + c.pending.at);
    }
    if (c.err) parts.push(`<div class="cm cm-error" data-k="m-err" role="alert" data-testid="chat-error"><p>${esc(c.err.msg)}</p>${c.err.retry ? '<button type="button" class="btn ghost sm" data-act="chat-retry" data-testid="chat-retry">Try again</button>' : ''}</div>`);
    const th = panel.querySelector('.chat-thread');
    const made = patchThread(th, parts, switched || force);
    S.sig = sig;
    made.forEach(n => {                                                    // only what just arrived animates, once
      if (!n.classList.contains('cm-new')) return;
      if (n.classList.contains('cm-agent')) arrive(n, +n.dataset.reveal || 0);
      setTimeout(() => n.classList.remove('cm-new', 'cm-reveal'), 2500);
    });
    panel.dataset.cur = c.key;
    // where to land: a chat you return to opens where you left it (newest by default); in the chat you're reading,
    // follow new content while you're at the bottom (or just sent), otherwise leave you be and offer "Latest"
    const toEnd = () => { c.follow = true; sc.scrollTop = sc.scrollHeight; jump(false); };      // instant: new messages fade in instead
    if (switched) { if (c.scroll != null && c.scroll > 48) { c.follow = false; sc.scrollTop = sc.scrollHeight - sc.clientHeight - c.scroll; jump(true); } else toEnd(); }
    else if (S.stick || c.follow) toEnd();
    else if (sc.scrollHeight > sc.clientHeight) jump(true);
    S.stick = false;
    if (c.unread && S.open) { c.unread = false; paintHistory(); }
  }
  // dock state
  const ta = input();
  if (switched || force) { if (ta.value !== c.draft) { ta.value = c.draft || ''; grow(ta); } }
  ta.disabled = off; ta.placeholder = off ? 'Chat is unavailable right now' : c.pending ? 'Your next question…' : 'Ask about your data…';
  panel.querySelector('.chat-composer').classList.toggle('off', off);
  panel.querySelector('.chat-mic').disabled = off;
  panel.querySelector('.chat-hist-btn').setAttribute('aria-expanded', String(wide ? S.hist : !!histSheet));
  syncSend();
  // desktop history pane
  const pane = panel.querySelector('.chat-hist-pane'), showPane = wide && S.hist;
  if (pane.hidden === showPane) pane.hidden = !showPane;
  panel.classList.toggle('hist-on', showPane);
  paintHistory();
}

export function dictateInto(text, reason) {
  const ta = input(); if (!ta) return;
  if (text) { ta.value = ta.value.trim() ? `${ta.value.trim()} ${text}` : text; grow(ta); cv().draft = ta.value; syncSend(); }
  else if (reason) toast(reason);
  if (!ta.disabled) ta.focus();
}

// phones: drag the header down to close (the sheet follows the finger; let go past ~90 px, or flick, and it drops away)
function dragToClose(root) {
  const head = root.querySelector('.chat-head');
  let y0 = null, dy = 0, t0 = 0;
  head.addEventListener('pointerdown', e => { if (e.button > 0 || wideMq.matches || e.target.closest('button, a')) return; y0 = e.clientY; dy = 0; t0 = e.timeStamp; try { head.setPointerCapture(e.pointerId); } catch { /* synthetic */ } });
  head.addEventListener('pointermove', e => { if (y0 === null) return; dy = Math.max(0, e.clientY - y0); root.style.transform = dy ? `translate3d(0, ${dy}px, 0)` : ''; });
  const end = e => {
    if (y0 === null) return;
    const v = dy / Math.max(1, e.timeStamp - t0); y0 = null;
    if (dy > 90 || (dy > 30 && v > 0.6)) { actions['chat-close']?.(); return; }
    if (dy) root.animate([{ transform: `translate3d(0, ${dy}px, 0)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
    root.style.transform = '';
  };
  head.addEventListener('pointerup', end); head.addEventListener('pointercancel', end);
}

// desktop: drag the top-left corner to resize; the size is kept on this device and always fits the window
const SIZE = { w: [360, 760], h: [380, 0.9] };
function applySize() {
  if (!panel) return;
  const s = local('chatPanelSize', null);
  if (!wideMq.matches || !s) { panel.style.removeProperty('--cp-w'); panel.style.removeProperty('--cp-h'); return; }
  panel.style.setProperty('--cp-w', `${Math.round(s.w)}px`); panel.style.setProperty('--cp-h', `${Math.round(s.h)}px`);
}
function resizable(root) {
  const grip = root.querySelector('.chat-resize');
  let st = null;
  grip.addEventListener('pointerdown', e => { if (!wideMq.matches || e.button > 0) return; e.preventDefault(); const r = root.getBoundingClientRect(); st = { x: e.clientX, y: e.clientY, w: r.width, h: r.height }; grip.setPointerCapture?.(e.pointerId); root.classList.add('resizing'); });
  grip.addEventListener('pointermove', e => {
    if (!st) return;
    const w = Math.max(SIZE.w[0], Math.min(SIZE.w[1], innerWidth - 48, st.w + (st.x - e.clientX)));
    const h = Math.max(SIZE.h[0], Math.min(innerHeight * SIZE.h[1], st.h + (st.y - e.clientY)));
    root.style.setProperty('--cp-w', `${Math.round(w)}px`); root.style.setProperty('--cp-h', `${Math.round(h)}px`); st.cw = w; st.ch = h;
  });
  const end = () => { if (!st) return; if (st.cw) setLocal('chatPanelSize', { w: st.cw, h: st.ch }); st = null; root.classList.remove('resizing'); };
  grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
  grip.addEventListener('dblclick', () => { setLocal('chatPanelSize', null); applySize(); });
}

// ---------------------------------------------------------------- sending (one request per chat, any number of chats)
async function send(raw) {
  const text = String(raw || '').trim();
  const conv = cv();
  if (!text || conv.pending) return;
  if (chatBlocker()) { paint(); return; }
  conv.pending = { text, at: Date.now() }; conv.err = null; conv.updatedAt = Date.now(); conv.draft = '';
  S.stick = true;
  const ta = input(); if (ta) { ta.value = ''; grow(ta); }
  paint();
  try {
    const r = await sendChat(conv.id, text);
    if (!S.convs.has(conv.key)) return;                       // deleted while it was answering
    if (!conv.id) conv.id = r.chatId;
    if (r.title) conv.title = r.title;
    appendUnique(conv.msgs, r.user, r.message);
    if (r.user?.id) (S.rendered.get(conv.key) || S.rendered.set(conv.key, new Set()).get(conv.key)).add(r.user.id);   // its bubble is already on screen
    conv.loaded = true; conv.updatedAt = Date.now();
    if (S.cur === conv.key && S.open) rememberChat({ chat: { id: conv.id, title: titleOf(conv) }, messages: conv.msgs });
    else { conv.unread = true; toast(`Answer ready in “${titleOf(conv) || 'your other chat'}”.`); }
    loadList();
  } catch (e) {
    console.warn('[chat] send failed', e?.status, e?.message);  // debug detail stays in the console
    const f = friendlyError(e, navigator.onLine);
    if (!S.convs.has(conv.key)) return;
    conv.err = { msg: f.msg, retry: f.retry, text };
    if (f.off) S.off = true;
    if (!conv.draft) conv.draft = text;                       // the question goes back in that chat's box
    if (S.cur === conv.key) { const t = input(); if (t && !t.value) { t.value = text; grow(t); } }
    else conv.unread = true;
  } finally {
    conv.pending = null;                                      // follows the answer only if you're still at the bottom
    paint();
  }
}

function switchTo(conv) {
  const was = cv(), ta = input();
  if (ta) was.draft = ta.value;
  const sc = scroller(); if (sc) was.scroll = sc.scrollHeight - sc.scrollTop - sc.clientHeight;
  S.cur = conv.key; conv.unread = false;
  paint();
  if (conv.id && !conv.pending && !conv.loading) refresh(conv);
}
async function refresh(conv) {
  conv.loading = true; if (!conv.loaded) paint();
  try {
    const r = await getChat(conv.id);
    if (!S.convs.has(conv.key)) return;
    conv.title = r.chat.title;
    if (!conv.pending) { conv.msgs = r.messages || []; conv.loadedAt = Date.now(); }
    conv.loaded = true;
    if (S.cur === conv.key) rememberChat({ chat: { id: conv.id, title: titleOf(conv) }, messages: conv.msgs });
  } catch (e) {
    console.warn('[chat] open failed', e?.status, e?.message);
    if (e.status === 404) { toast('That chat is gone.'); dropConv(conv); loadList(); }
    else if (!conv.loaded) { conv.err = { msg: friendlyError(e, navigator.onLine).msg, retry: false }; conv.loaded = true; }
  } finally { conv.loading = false; paint(); }
}
function open(id, key) {
  let conv = key ? S.convs.get(key) : byId(id);
  if (!conv && id) conv = newConv({ id, loaded: false, title: (S.list || []).find(x => x.id === id)?.title || null });
  if (!conv) return;
  switchTo(conv);
}
function dropConv(conv) {
  S.convs.delete(conv.key); S.rendered.delete(conv.key);
  if (S.cur === conv.key) { S.cur = null; cv(); }
}
function fresh() {
  histSheet?.close(); S.hist = false;
  const c = cv();
  if (!c.msgs.length && !c.pending && !c.id && !c.err) { paint(); setTimeout(() => input()?.focus(), 60); return; }
  switchTo([...S.convs.values()].find(x => !x.id && !x.pending && !x.msgs.length && !x.err) || newConv());
  setTimeout(() => input()?.focus(), 60);
}

actions['chat-suggest'] = el => {
  if (el.dataset.fill) { const ta = input(); ta.value = el.dataset.q; grow(ta); cv().draft = ta.value; syncSend(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); return; }
  send(el.dataset.q);
};
actions['chat-retry'] = () => { const c = cv(), t = c.err?.text; c.err = null; const ta = input(); if (ta && ta.value.trim() === t) { ta.value = ''; grow(ta); c.draft = ''; } send(t); };
actions['chat-new'] = () => fresh();
actions['chat-hist'] = () => { if (!wideMq.matches && histSheet) histSheet.close(); else openHistory(); };
actions['chat-open'] = el => { histSheet?.close(); if (wideMq.matches) S.hist = false; open(el.dataset.id, el.dataset.key); };
actions['chat-jump'] = () => { const sc = scroller(); sc?.scrollTo({ top: sc.scrollHeight, behavior: motion.calm() ? 'auto' : 'smooth' }); jump(false); };
actions['chat-mic'] = el => { if (!el.disabled) openVoice(); };      // dictation into the box (app.js sets the mic target)
actions['chat-signin'] = () => { location.hash = '#/you'; };
actions['chat-rename'] = el => {
  const id = el.dataset.id, cur = titles()[id] || (S.list || []).find(x => x.id === id)?.title || byId(id)?.title || '';
  const sh = openSheet({ title: 'Rename chat', cls: 'chat-rename-sheet', body: `<form class="stack" data-testid="chat-rename-form"><input class="input" name="t" maxlength="80" value="${esc(cur)}" aria-label="Chat name" data-testid="chat-rename-input">
      <div class="row end gap"><button type="button" class="btn ghost" data-no>Cancel</button><button type="submit" class="btn primary" data-testid="chat-rename-save">Save</button></div></form>`,
  onMount: (b, api) => {
    const f = b.querySelector('form'), inp = f.querySelector('input');
    setTimeout(() => { inp.focus(); inp.select(); }, 80);
    b.querySelector('[data-no]').onclick = () => api.close();
    f.onsubmit = async e => {
      e.preventDefault(); const t = inp.value.trim().slice(0, 80); api.close(); if (!t || t === cur) return;
      const map = { ...titles() }; map[id] = t; setLocal('chatTitles', map);          // shows at once (and stays on this device if the server can't rename)
      const conv = byId(id); if (conv) conv.title = t;
      const it = (S.list || []).find(x => x.id === id); if (it) it.title = t;
      paint(); paintHistory();
      try { await renameChat(id, t); const m = { ...titles() }; delete m[id]; setLocal('chatTitles', m); }
      catch (err) { if (err.status !== 404 && err.status !== 405) console.warn('[chat] rename failed', err?.status, err?.message); }
    };
  } });
  void sh;
};
actions['chat-del'] = async el => {
  const id = el.dataset.id, ch = (S.list || []).find(x => x.id === id), conv = byId(id);
  if (!(await confirmSheet(`Delete “${titles()[id] || ch?.title || conv?.title || 'this chat'}”? This can’t be undone.`, 'Delete', true))) return;
  try {
    await deleteChat(id);
    S.list = (S.list || []).filter(x => x.id !== id);
    if (conv) dropConv(conv);
    if (lastChat()?.chat?.id === id) rememberChat(null);
    const m = { ...titles() }; if (m[id]) { delete m[id]; setLocal('chatTitles', m); }
    toast('Chat deleted.');
  } catch (e) { console.warn('[chat] delete failed', e?.status, e?.message); toast(e.status === 404 ? 'That chat was already gone.' : 'Couldn’t delete that chat. Try again in a moment.'); if (e.status === 404) { S.list = (S.list || []).filter(x => x.id !== id); if (conv) dropConv(conv); } }
  paint(); paintHistory();
};
