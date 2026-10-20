// The voice agent, behind the Ask button: press and hold to talk (release to finish; a pause or Done ends a hands-free turn).
// Tap Ask opens Chat instead (js/app.js). Typing works too.
// Flow: record → /api/agent/transcribe (Sarvam) → editable transcript → /api/agent/plan (Gemini/Sarvam/rules)
//       → draft cards showing exactly what will change → Accept (per card or all) → local store → sync.
// Nothing is written before Accept. The whole session can be undone from the toast afterwards.
import { I } from './icons.js';
import { esc, fmtTime, fmtDateKey, todayKey } from '../core/util.js';
import { openSheet, toast, sheetOpen } from './ui.js';
import { all, get, local, setLocal } from '../data/store.js';
import { cloudReady, serverConfig } from '../data/sync.js';
import { transcribeAudio, planText, applyDraft, undoChanges, sendLearning } from '../data/agent.js';
import { missing, TYPE_LABEL } from '../core/agent.js';
import { fmtINR, DEFAULT_CATEGORIES, INCOME_CATEGORIES, canonicalCategory } from '../core/money.js';
import { knownCategories } from './views/money.js';
import { reconcileNtfy, rearmLocal } from '../platform/notify.js';
import * as motion from './motion.js';
import { HOLD_MS, releaseOutcome } from './press.js';

const TUNE = window.__steadyVoiceTune || {};   // test hook (shorter segments in e2e); unset in normal use
const MAX_MS = TUNE.max || 120_000, SEG_MS = TUNE.seg || 25_000, SILENCE_MS = TUNE.silence || 3200, MIN_SPEECH_MS = 450;
const PROVIDER = { gemini: 'Gemini', sarvam: 'Sarvam', rules: 'basic rules', device: 'this device' };
let cfg = local('serverConfig') || {};
serverConfig().then(c => { cfg = c || {}; }).catch(() => {});

const voiceSupported = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
export const voiceReady = () => voiceSupported() && cloudReady() && !!cfg.agent?.voice && navigator.onLine;

// ---------------------------------------------------------------- the button (part of the app shell)
// "Ask": the one floating button. TAP opens Chat (onTap). PRESS AND HOLD is the voice agent, exactly as before: the
// capture sheet opens and records while the finger is down (a pause never ends it), releasing finishes, then
// transcript → drafts → Accept. A hold let go of very quickly keeps listening hands-free (Done, or a pause, finishes).
const isDown = () => !!document.querySelector('.guide, .onboarding') || sheetOpen();
export const askButton = () => `<button class="ask-fab" id="ask-fab" type="button" data-testid="ask" aria-label="Ask about your data. Press and hold to talk to Steady" aria-keyshortcuts="V" title="Tap to ask · Hold to talk (V)">
  <span class="ask-ring" aria-hidden="true"></span>${I.ask}<span class="ask-label" aria-hidden="true">Ask</span></button>`;
export function mountAsk(root = document, { onTap } = {}) {
  const b = root.querySelector('#ask-fab'); if (!b || b.dataset.bound) return;
  b.dataset.bound = '1';
  let timer = 0, down = false, heldAt = 0, lastUp = -1e9;
  const tap = () => { hideHint(); onTap?.(); };
  const fire = () => {
    timer = 0; heldAt = performance.now();
    b.classList.remove('arming'); b.classList.add('holding');
    navigator.vibrate?.(10); hideHint(); setLocal('askHeld', true);
    openVoice();
    if (S) S.holding = true;        // while the finger is down, a pause never ends the recording
  };
  b.addEventListener('pointerdown', e => {
    if (e.button > 0 || sheetOpen()) return;
    down = true; heldAt = 0;
    try { b.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    b.classList.add('pressed', 'arming');
    clearTimeout(timer); timer = setTimeout(fire, HOLD_MS);
  });
  const up = cancel => {
    if (!down) return; down = false; lastUp = performance.now();
    b.classList.remove('pressed', 'arming', 'holding');
    if (timer) { clearTimeout(timer); timer = 0; if (releaseOutcome(0, cancel) === 'tap') tap(); return; }    // released before the hold: a tap
    if (S) S.holding = false;
    if (releaseOutcome(HOLD_MS + performance.now() - heldAt) === 'stop' && S?.phase === 'listening') stopRecording();   // hold-to-talk: release = done
  };
  b.addEventListener('pointerup', () => up(false)); b.addEventListener('pointercancel', () => up(true));
  // if the button loses the pointer (a sheet or permission prompt took it), the finger lifting anywhere still counts
  addEventListener('pointerup', () => up(false), true); addEventListener('pointercancel', () => up(true), true);
  addEventListener('blur', () => up(true));
  // the click Chrome sends after a long press lands on whatever is under the finger (the new sheet): swallow it
  addEventListener('click', e => { if (heldAt && performance.now() - lastUp < 700) { e.preventDefault(); e.stopPropagation(); heldAt = 0; } }, true);
  b.addEventListener('contextmenu', e => e.preventDefault());          // a long press must not open the browser menu
  // keyboard (Enter/Space) and assistive tech send a click with no pointer sequence: that's a tap
  b.addEventListener('click', e => { e.preventDefault(); if (down || performance.now() - lastUp < 700 || sheetOpen()) return; tap(); });
  // tuck away while reading down a page (so it never sits on top of an amount), back as soon as you scroll up
  let lastY = scrollY;
  addEventListener('scroll', () => {
    const y = scrollY, atEnd = innerHeight + y >= document.documentElement.scrollHeight - 40;
    if (Math.abs(y - lastY) < 8 && !atEnd) return;
    b.classList.toggle('tucked', y > lastY && y > 60 && !atEnd);
    lastY = y;
  }, { passive: true });
  addEventListener('hashchange', () => b.classList.remove('tucked'));
  // first runs: a quiet hint above the button, so both gestures are discoverable (until the first hold, at most 3 times)
  if (!local('askHeld') && (+local('askHintN', 0) || 0) < 3) {
    let tries = 0;
    const show = () => {
      if (!b.isConnected || local('askHeld')) return;
      if ((isDown() || document.documentElement.classList.contains('chat-open')) && tries++ < 20) { setTimeout(show, 1500); return; }
      if (tries > 20) return;
      setLocal('askHintN', (+local('askHintN', 0) || 0) + 1);
      const h = document.createElement('div');
      h.className = 'ask-hint'; h.id = 'ask-hint'; h.setAttribute('role', 'note'); h.dataset.testid = 'ask-hint';
      h.innerHTML = '<span><b>Tap</b> to ask</span><i aria-hidden="true"></i><span><b>Hold</b> to talk</span>';
      b.after(h); requestAnimationFrame(() => h.classList.add('show'));
      setTimeout(hideHint, 7000);
    };
    setTimeout(show, 1200);
  }
}
function hideHint() { const h = document.getElementById('ask-hint'); if (!h) return; h.classList.remove('show'); setTimeout(() => h.remove(), 300); }

// ---------------------------------------------------------------- session
// A screen can take over the mic to dictate into its own field (Chat: the composer). Then the mic only transcribes:
// no planning, no drafts, nothing is saved; the words land in the field for the user to edit and send.
let micTarget = null;
export const setMicTarget = fn => { micTarget = fn || null; };
let S = null;
export function openVoice({ mode } = {}) {
  if (S) return;
  const dictate = micTarget;
  if (dictate && (mode === 'type' || !voiceReady())) { dictate(null, whyTyping(mode).replace(/ ?(Type it instead\.|Typing works( now)?\.|Type it; this device will understand\.|or type here\.)$/, '').trim()); return; }
  const useVoice = mode !== 'type' && voiceReady();
  S = { phase: 'idle', drafts: [], originals: {}, undo: [], pairs: [], text: '', meta: null, dictate };
  const api = openSheet({ title: dictate ? 'Speak your question' : 'Tell Steady', cls: 'voice-sheet', body: '<div class="vx" id="vx" data-testid="voice-sheet"></div>',
    onMount: (b) => { S.root = b.querySelector('#vx'); b.addEventListener('click', onClick); b.addEventListener('submit', onSubmit); } });
  S.api = api;
  api.onClose = () => finish(true);
  if (useVoice) startRecording(); else renderTyping(whyTyping(mode));
}
function whyTyping(mode) {
  if (mode === 'type') return '';
  if (!voiceSupported()) return 'Voice isn’t available in this browser. Type it instead.';
  if (!cloudReady()) return 'Sign in from You (top right) to talk. Typing works now.';
  if (!navigator.onLine) return 'Offline. Type it; this device will understand.';
  if (!cfg.agent?.voice) return 'Voice isn’t on for this Steady yet. Typing works.';
  return '';
}
const $ = sel => S?.root?.querySelector(sel);
function set(state, html) {
  if (!S?.root) return; S.phase = state; S.root.dataset.state = state; S.root.innerHTML = html;
  S.root.querySelectorAll('textarea').forEach(grow);
}
const grow = ta => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight + 2, 220)}px`; };
document.addEventListener('input', e => { if (e.target.matches?.('.vx textarea')) grow(e.target); });

// ---------------------------------------------------------------- recording
// Every async step checks it still belongs to the live session and recording attempt (S === s && s.gen === gen), so a slow
// transcription or a late recorder event from a previous tap can never land in (and break) the next one.
// Long speech is recorded in ~25 s segments (Sarvam's synchronous STT takes ≤ 30 s per file), cut at a natural pause, and
// transcribed while you keep talking; the transcripts are joined in order. Up to 2 minutes per turn.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const live = (s, gen) => S === s && s.gen === gen && s.phase === 'listening';
let micFree = Promise.resolve();          // the previous session's mic/audio teardown; the next getUserMedia waits for it
async function getMic() {
  await micFree;
  const c = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } };
  for (let i = 0; ; i++) {
    try { return await navigator.mediaDevices.getUserMedia(c); }
    catch (e) {   // NotReadableError/AbortError: the OS hasn't released the mic from the last tap yet; give it a moment
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError' || i >= 3) throw e;
      await sleep(200 * (i + 1));
    }
  }
}
const pickMime = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported?.(t)) || '';
async function startRecording() {
  const s = S; if (!s) return;
  const gen = (s.gen = (s.gen || 0) + 1);
  set('listening', `<div class="vx-listen">
      <canvas class="vx-wave" aria-hidden="true"></canvas>
      <div class="vx-timer"><span class="vx-dot"></span><span id="vx-time">0:00</span></div>
      <p class="vx-hint" id="vx-hint">Listening. English, తెలుగు, or both.<br><small>Take your time. Tap Done when you finish.</small></p></div>
    <div class="vx-actions"><button class="btn ghost sm" type="button" data-vx="type">${I.keyboard}<span>Type instead</span></button>
      <button class="btn primary" type="button" data-vx="stop" data-testid="vx-stop">${I.stop}<span>Done</span></button></div>`);
  let stream;
  try { stream = await getMic(); }
  catch (e) {
    if (S === s && s.gen === gen) renderTyping(e.name === 'NotAllowedError' ? 'Microphone access is blocked for Steady. Allow it in the browser’s site settings, or type here.' : 'The microphone is busy right now. Type it, or try again in a second.');
    return;
  }
  if (!live(s, gen)) { stream.getTracks().forEach(t => t.stop()); return; }
  s.stream = stream; s.segs = []; s.segErr = null; s.blobBytes = 0;
  s.mime = pickMime();
  s.t0 = performance.now();
  startSegment(s, gen);
  navigator.vibrate?.(8);
  meter(s, gen);
}
function startSegment(s, gen) {
  const chunks = [];
  const rec = new MediaRecorder(s.stream, s.mime ? { mimeType: s.mime, audioBitsPerSecond: 32000 } : undefined);
  rec.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
  rec.onstop = () => onSegment(s, gen, new Blob(chunks, { type: rec.mimeType || s.mime || 'audio/webm' }), !!rec.final);
  rec.start(250);
  s.rec = rec; s.segT0 = performance.now();
}
// Rotate to a new segment: start the next recorder first, then stop the old one, so no audio falls in the gap.
function rotate(s, gen) { const old = s.rec; startSegment(s, gen); old.final = false; if (old.state !== 'inactive') old.stop(); }
function onSegment(s, gen, blob, final) {
  if (S !== s || s.gen !== gen) return;
  s.blobBytes += blob.size;
  if (blob.size >= 800) s.segs.push(transcribeAudio(blob).then(r => r.transcript || '').catch(e => { s.segErr = e; return ''; }));
  if (final) finalize(s, gen);
}
function meter(s, gen) {
  try {
    s.ac = new (window.AudioContext || window.webkitAudioContext)();
    const src = s.ac.createMediaStreamSource(s.stream); s.an = s.ac.createAnalyser(); s.an.fftSize = 1024; src.connect(s.an);
  } catch { s.an = null; }
  const cv = $('.vx-wave'), ctx = cv?.getContext('2d');
  const buf = new Float32Array(1024), hist = new Array(48).fill(0);
  // Adaptive voice detection: learn the room's noise floor, call it speech only well above it, and finish only after a
  // real pause (SILENCE_MS) once you've actually spoken. Holding the button never auto-finishes.
  let floor = 0.008, speechMs = 0, quietSince = 0, lastDraw = 0, last = performance.now(), hinted = false;
  const calmMotion = motion.calm();
  const tick = now => {
    if (!live(s, gen)) return;
    const el = now - s.t0, dt = now - last; last = now;
    let rms = 0;
    if (s.an) { s.an.getFloatTimeDomainData(buf); for (const v of buf) rms += v * v; rms = Math.sqrt(rms / buf.length); }
    const speakTh = Math.max(0.018, floor * 3), quietTh = Math.max(0.01, floor * 1.8);
    if (rms > speakTh) { speechMs += dt; quietSince = 0; }
    else { if (rms < quietTh) quietSince ||= now; floor = floor * 0.97 + Math.min(rms, 0.05) * 0.03; }
    const heard = speechMs > MIN_SPEECH_MS;
    const quietFor = quietSince ? now - quietSince : 0;
    const hint = $('#vx-hint');
    if (hint && heard && !s.holding) {
      const want = quietFor > 1200;
      if (want !== hinted) { hinted = want; hint.innerHTML = want ? 'Finishing in a moment…<br><small>Keep talking to continue.</small>' : 'Listening. English, తెలుగు, or both.<br><small>Take your time. Tap Done when you finish.</small>'; }
    }
    if (el > MAX_MS || (heard && !s.holding && quietFor > SILENCE_MS)) { stopRecording(); return; }
    const segEl = now - s.segT0;
    if (segEl > SEG_MS && (quietFor > 250 || segEl > SEG_MS + 4000)) rotate(s, gen);
    const tEl = $('#vx-time');
    if (tEl) { const sec = Math.floor(el / 1000); tEl.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}${el > MAX_MS - 10_000 ? ' / 2:00' : ''}`; }
    if (ctx && (!calmMotion || now - lastDraw > 200)) { lastDraw = now; hist.push(Math.min(1, rms * 9)); hist.shift(); drawWave(cv, ctx, hist); }
    s.raf = requestAnimationFrame(tick);
  };
  s.raf = requestAnimationFrame(tick);
}
function drawWave(cv, ctx, hist) {
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  const css = getComputedStyle(cv); ctx.fillStyle = css.color;
  const n = hist.length, gap = 4, bw = Math.max(2, (w - gap * (n - 1)) / n);
  hist.forEach((v, i) => { const bh = Math.max(4, v * (h - 6)); const x = i * (bw + gap); const y = (h - bh) / 2; ctx.globalAlpha = 0.35 + 0.65 * (i / n); roundRect(ctx, x, y, bw, bh, bw / 2); ctx.fill(); });
  ctx.globalAlpha = 1;
}
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

export function stopRecording() {
  const s = S;
  if (!s || s.phase !== 'listening') return;
  s.phase = 'stopping';
  cancelAnimationFrame(s.raf);
  if (s.rec && s.rec.state !== 'inactive') { s.rec.final = true; s.rec.stop(); } else finalize(s, s.gen);
}
function releaseMic(s = S) {
  if (!s) return;
  s.stream?.getTracks().forEach(t => t.stop());
  const ac = s.ac; s.stream = null; s.ac = null; s.an = null;
  micFree = Promise.all([ac?.close?.().catch(() => {}), sleep(120)]);
}

async function finalize(s, gen) {
  if (S !== s || s.gen !== gen) return;
  releaseMic(s);
  const dur = performance.now() - (s.t0 || 0);
  window.__steadyVoice.last = { ms: Math.round(dur), bytes: s.blobBytes, type: s.mime, segments: s.segs.length };
  if (dur < 500 || !s.segs.length) { renderError('I didn’t catch anything. Try again a little closer to the mic.'); return; }
  renderThinking('', s.segs.length > 1 ? `Transcribing ${s.segs.length} parts…` : 'Transcribing…');
  const parts = await Promise.all(s.segs);
  if (S !== s || s.gen !== gen) return;
  const text = parts.map(x => x.trim()).filter(Boolean).join(' ');
  if (!text) { renderError(s.segErr ? friendly(s.segErr) : 'I couldn’t make out any words. Try again, or type it.'); return; }
  if (s.dictate) { const fn = s.dictate; s.api.close(); fn(text); return; }
  await understand(text);
}

// ---------------------------------------------------------------- understanding
async function understand(text) {
  const s = S; if (!s) return;
  s.text = text.trim();
  if (!s.text) return;
  const gen = (s.gen = (s.gen || 0) + 1);
  renderThinking(s.text, 'Understanding…');
  const t0 = performance.now();
  try {
    const r = await planText(s.text);
    if (S !== s || s.gen !== gen) return;
    s.drafts = r.drafts || []; s.originals = Object.fromEntries(s.drafts.map(d => [d.key, structuredClone(d)]));
    s.meta = { provider: r.provider, ms: Math.round(performance.now() - t0), clarification: r.clarification };
    renderReview();
  } catch (e) { if (S === s && s.gen === gen) renderError(friendly(e), true); }
}

// ---------------------------------------------------------------- states
function renderTyping(note = '') {
  releaseMic();
  if (S?.dictate) { const fn = S.dictate; S.api.close(); fn(null); return; }   // dictating: typing happens in the screen's own field
  set('typing', `<form class="vx-typeform" data-vx-form="type">
      ${note ? `<p class="hint">${esc(note)}</p>` : ''}
      <textarea id="vx-text" rows="3" autofocus aria-label="What happened or what you need" placeholder="e.g. 250 lunch, finished DSA, remind me to call amma at 7">${esc(S.text || '')}</textarea>
      <div class="vx-actions">${voiceReady() ? `<button class="btn ghost sm" type="button" data-vx="voice">${I.mic}<span>Speak instead</span></button>` : '<span></span>'}
        <button class="btn primary" type="submit" data-testid="vx-understand">Understand</button></div></form>`);
  const ta = $('#vx-text'); ta?.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey && matchMedia('(pointer:fine)').matches)) { e.preventDefault(); ta.form.requestSubmit(); } });
  if (ta && matchMedia('(pointer:fine)').matches) setTimeout(() => ta.focus(), 80);
}
// network failures surface as "Failed to fetch" / "Load failed"; say what happened and what still works
const friendly = e => (!navigator.onLine || e?.name === 'TypeError' || /fetch|network|load failed/i.test(e?.message || ''))
  ? 'No connection right now. Type it and this device will understand it.'
  : e?.name === 'AbortError' || /timeout|timed out/i.test(e?.message || '') ? 'That took too long. Try again, or type it.'
  : (e?.message || 'Something went wrong. Try again.');
let slowTimer;
function renderThinking(text, label) {
  clearTimeout(slowTimer);
  slowTimer = setTimeout(() => { const st = S?.phase === 'thinking' && $('.vx-status'); if (st) st.lastChild.textContent = `${label.replace(/…$/, '')}, still working…`; }, 7000);
  set('thinking', `${text ? saidBlock(text, true) : ''}
    <p class="vx-status" role="status"><span class="vx-spin" aria-hidden="true"></span>${esc(label)}</p>
    <div class="vx-skel" aria-hidden="true"><div class="card dcard skel"></div><div class="card dcard skel short"></div></div>`);
}
function renderError(msg, canRetry = false) {
  releaseMic();
  set('error', `${S.text ? saidBlock(S.text) : ''}<p class="vx-error" role="alert">${esc(msg)}</p>
    <div class="vx-actions"><button class="btn ghost sm" type="button" data-vx="type">${I.keyboard}<span>Type it</span></button>
      ${canRetry && S.text ? '<button class="btn primary sm" type="button" data-vx="retry">Try again</button>' : voiceReady() ? `<button class="btn primary sm" type="button" data-vx="voice">${I.mic}<span>Try again</span></button>` : ''}</div>`);
}
const saidBlock = (text, readonly = false) => `<form class="vx-said" data-vx-form="said"><span class="eyebrow">You said</span>
  <div class="vx-said-row"><textarea id="vx-said" rows="${Math.max(1, Math.min(6, Math.ceil(text.length / 30)))}" aria-label="What you said (edit to fix)" ${readonly ? 'readonly' : ''}>${esc(text)}</textarea>
  ${readonly ? '' : `<button class="icon-btn" type="submit" aria-label="Understand again" title="Edit and understand again" data-testid="vx-rerun">${I.sync}</button>`}</div></form>`;

function renderReview() {
  const live = S.drafts.filter(d => !d.gone);
  if (!S.drafts.length) {
    set('review', `${saidBlock(S.text)}<section class="empty small"><p class="serif big">Nothing to add.</p><p class="muted">${esc(S.meta?.clarification || 'Try “spent 200 on lunch” or “remind me to call home at 7”.')}</p></section>
      <div class="vx-actions"><button class="btn ghost sm" type="button" data-vx="type">${I.keyboard}<span>Type it</span></button>${voiceReady() ? `<button class="btn primary sm" type="button" data-vx="voice">${I.mic}<span>Try again</span></button>` : ''}</div>`);
    return;
  }
  const cats = [...new Set([...knownCategories(), ...DEFAULT_CATEGORIES, ...INCOME_CATEGORIES])];
  set('review', `${saidBlock(S.text)}
    <p class="vx-meta small muted" data-testid="vx-meta">${live.length} ${live.length === 1 ? 'thing' : 'things'} to review · understood by ${esc(PROVIDER[S.meta?.provider] || S.meta?.provider || '')}${S.meta?.ms > 150 ? ` · ${(S.meta.ms / 1000).toFixed(1)} s` : ''}</p>
    <datalist id="vx-cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <div class="vx-cards" data-testid="vx-cards">${S.drafts.map(card).join('')}</div>
    <div class="vx-foot"><button class="btn ghost sm" type="button" data-vx="discard-all">Discard</button>
      <button class="btn primary" type="button" data-vx="accept-all" data-testid="vx-accept-all">${I.check}<span>Accept ${live.length > 1 ? `all ${live.length}` : ''}</span></button></div>`);
  motion.stagger(S.root.querySelectorAll('.dcard'), 0, { base: 0, step: 50 });
}

// ---------------------------------------------------------------- draft cards
const ICON = { task: I.today, reminder: I.bell, complete: I.check, progress: I.goals, goal: I.goals, money: I.money, thought: I.thoughts };
const sel = (f, opts, v) => `<select data-f="${f}">${opts.map(([val, l]) => `<option value="${esc(val)}" ${String(val) === String(v ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const fld = (label, inner, cls = '') => `<label class="field ${cls}"><span>${label}</span>${inner}</label>`;
const inp = (f, v, attrs = '') => `<input data-f="${f}" value="${esc(v ?? '')}" ${attrs}>`;

function effect(d) {
  const f = d.f;
  switch (d.type) {
    case 'task': return `Adds “${f.title}” to ${fmtDateKey(f.dueDate || todayKey()).toLowerCase() === 'today' ? 'today' : fmtDateKey(f.dueDate)}${f.dueTime ? ` at ${fmtTime(f.dueTime)}` : ''}${f.reminder && f.dueTime ? ', with a reminder' : ''}.`;
    case 'reminder': return f.dueTime ? `Reminds you to “${f.title}” ${fmtDateKey(f.dueDate).toLowerCase() === 'today' || fmtDateKey(f.dueDate).toLowerCase() === 'tomorrow' ? fmtDateKey(f.dueDate).toLowerCase() : `on ${fmtDateKey(f.dueDate)}`} at ${fmtTime(f.dueTime)}.` : `Reminder for “${f.title}”. Pick a time.`;
    case 'complete': { const t = f.taskId && get('tasks', f.taskId); return t ? `Marks “${t.title}” done.` : `Logs “${f.title}” as done today.`; }
    case 'progress': { const g = get('goals', f.goalId); const m = g?.milestones?.find(x => x.id === f.milestoneId); return `${f.logTask !== false ? `Logs “${f.title}” toward “${g?.title || 'goal'}”` : `Updates “${g?.title || 'goal'}”`}${f.markMilestone && m ? ` and completes “${m.title}”` : ''}.`; }
    case 'goal': return `Creates the goal “${f.title}”${f.milestones?.length ? ` with ${f.milestones.length} weekly milestone${f.milestones.length > 1 ? 's' : ''}` : ''}.`;
    case 'money': return f.amount > 0 ? `Logs ${f.kind === 'income' ? 'income of' : 'an expense of'} ${fmtINR(f.amount)} · ${f.category} · ${fmtDateKey(f.date).toLowerCase() === 'today' ? 'today' : fmtDateKey(f.date)}.` : 'How much was it?';
    case 'thought': return `Saves a${f.kind === 'idea' ? 'n idea' : f.kind === 'journal' ? ' journal line' : ' note'}: “${f.text.length > 90 ? f.text.slice(0, 89) + '…' : f.text}”.`;
  }
  return '';
}

function card(d) {
  const f = d.f, k = d.key, goals = all('goals');
  let body = '';
  switch (d.type) {
    case 'task': case 'reminder':
      body = fld('Task', inp('title', f.title, 'required'))
        + `<div class="grid2">${fld('Day', inp('dueDate', f.dueDate, 'type="date"'))}${fld('Time', inp('dueTime', f.dueTime, 'type="time"'), d.needs.includes('time') ? 'need' : '')}</div>`
        + (goals.length ? fld('Goal', sel('goalId', [['', 'None'], ...goals.map(g => [g.id, g.title])], f.goalId)) : '');
      break;
    case 'complete': {
      const open = all('tasks').filter(t => t.status === 'open').sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
      const ids = new Set(); const opts = [];
      for (const t of [...(f.taskId ? [get('tasks', f.taskId)].filter(Boolean) : []), ...d.candidates.map(c => get('tasks', c.id)).filter(Boolean), ...open]) if (!ids.has(t.id)) { ids.add(t.id); opts.push([t.id, `${t.title}${t.dueDate && t.dueDate !== todayKey() ? ` · ${fmtDateKey(t.dueDate)}` : ''}`]); }
      body = fld('Which task', sel('taskId', [['', '— Log as a new done item —'], ...opts.slice(0, 30)], f.taskId))
        + `<div class="dc-new ${f.taskId ? 'hidden' : ''}">${fld('What you did', inp('title', f.title))}</div>`;
      break;
    }
    case 'progress': {
      const g = get('goals', f.goalId); const m = g?.milestones?.find(x => x.id === f.milestoneId);
      body = fld('Goal', sel('goalId', goals.map(x => [x.id, x.title]), f.goalId)) + fld('What you did', inp('title', f.title))
        + (m ? `<label class="pick"><input type="checkbox" data-f="markMilestone" ${f.markMilestone ? 'checked' : ''}><span>Also complete milestone<small>${esc(m.title)}</small></span></label>` : '');
      break;
    }
    case 'goal':
      body = fld('Goal', inp('title', f.title, 'required')) + `<div class="grid2">${fld('Target date', inp('target', f.target, 'type="date"'))}${fld('Why it matters', inp('why', f.why))}</div>`
        + fld('Weekly milestones <small class="muted">(one per line)</small>', `<textarea data-f="milestones" rows="${Math.max(2, Math.min(5, f.milestones.length + 1))}">${esc(f.milestones.join('\n'))}</textarea>`);
      break;
    case 'money':
      body = `<div class="seg dc-kind" role="radiogroup" data-seg="kind-${k}">${[['expense', 'Expense'], ['income', 'Income']].map(([v, l]) => `<button type="button" role="radio" aria-checked="${f.kind === v}" data-v="${v}" class="${f.kind === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="grid2">${fld('Amount (₹)', inp('amount', f.amount, 'type="number" inputmode="decimal" min="0.01" step="0.01"'), d.needs.includes('amount') ? 'need' : '')}${fld('Category', inp('category', f.category, 'list="vx-cats"'))}</div>
        <div class="grid2">${fld('Note', inp('note', f.note))}${fld('Paid to / from', inp('payee', f.payee))}</div>${fld('Date', inp('date', f.date, `type="date" max="${todayKey()}"`))}`;
      break;
    case 'thought':
      body = fld('Thought', `<textarea data-f="text" rows="3">${esc(f.text)}</textarea>`)
        + `<div class="seg" role="radiogroup" data-seg="tk-${k}">${[['note', 'Note'], ['idea', 'Idea'], ['journal', 'Journal']].map(([v, l]) => `<button type="button" role="radio" aria-checked="${f.kind === v}" data-v="${v}" class="${f.kind === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
      break;
  }
  const unsure = d.confidence < 0.55 || d.warnings.includes('no-goal');
  const sub = d.type === 'money' ? (f.kind === 'income' ? 'Income' : 'Expense') : d.type === 'complete' && f.taskId ? 'existing task' : '';
  const open = unsure || d.needs.length > 0;
  return `<article class="card dcard t-${d.type} ${unsure ? 'unsure' : ''} ${open ? '' : 'collapsed'}" data-key="${k}" data-type="${d.type}" data-testid="draft-${d.type}">
    <header class="dc-head"><span class="dc-ic" aria-hidden="true">${ICON[d.type]}</span><span class="eyebrow">${TYPE_LABEL[d.type]}${sub ? ` · ${sub}` : ''}</span>
      <button class="icon-btn subtle" type="button" data-vx="discard" aria-label="Discard this">${I.close}</button></header>
    <p class="dc-effect" data-effect>${esc(effect(d))}</p>
    ${unsure ? '<p class="dc-warn small">Not fully sure about this one. Check it before accepting.</p>' : ''}
    <div class="dc-body">${body}</div>
    ${d.evidence ? `<p class="dc-said small muted">“${esc(d.evidence)}”</p>` : ''}
    <div class="dc-foot"><button class="btn ghost sm" type="button" data-vx="edit" aria-expanded="${open}">${open ? 'Done editing' : 'Edit'}</button><button class="btn primary sm" type="button" data-vx="accept" data-testid="vx-accept">${I.check}<span>Accept</span></button></div>
  </article>`;
}

// read a card's inputs back into a draft (what the user actually accepts)
function readCard(el, d) {
  const out = structuredClone(d), f = out.f;
  const v = name => el.querySelector(`[data-f="${name}"]`);
  const str = name => (v(name) ? v(name).value.trim() : undefined);
  switch (d.type) {
    case 'task': case 'reminder':
      f.title = str('title') ?? f.title; f.dueDate = str('dueDate') || todayKey(); f.dueTime = str('dueTime') || null;
      if (v('goalId')) f.goalId = str('goalId') || null;
      f.reminder = d.type === 'reminder' ? true : !!f.dueTime && (d.f.reminder || !d.f.dueTime);
      break;
    case 'complete': f.taskId = str('taskId') || null; f.title = str('title') || (f.taskId ? get('tasks', f.taskId)?.title : f.title); break;
    case 'progress': f.goalId = str('goalId') || f.goalId; f.title = str('title') || f.title; f.markMilestone = !!v('markMilestone')?.checked && f.goalId === d.f.goalId; break;
    case 'goal': f.title = str('title'); f.target = str('target') || null; f.why = str('why') || ''; f.milestones = (v('milestones')?.value || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 12); break;
    case 'money':
      f.kind = el.querySelector(`[data-seg="kind-${d.key}"] button.on`)?.dataset.v || f.kind;
      f.amount = str('amount') ? Math.round(+str('amount') * 100) / 100 : null;
      f.category = canonicalCategory(str('category') || f.category, knownCategories()); f.note = str('note') || ''; f.payee = str('payee') || null; f.date = str('date') || todayKey();
      break;
    case 'thought': f.text = v('text')?.value.trim() || ''; f.kind = el.querySelector(`[data-seg="tk-${d.key}"] button.on`)?.dataset.v || f.kind; break;
  }
  return out;
}

async function accept(el) {
  const d = S.drafts.find(x => x.key === el.dataset.key); if (!d || d.gone) return true;
  const after = readCard(el, d);
  const need = missing(after);
  el.querySelectorAll('.field.need').forEach(x => x.classList.remove('need'));
  if (need.length) {
    el.classList.remove('collapsed'); const eb = el.querySelector('[data-vx="edit"]'); if (eb) eb.textContent = 'Done editing';
    const map = { amount: 'amount', time: 'dueTime', title: 'title', date: 'date', target: 'title', goal: 'goalId', category: 'category', text: 'text' };
    const inpEl = el.querySelector(`[data-f="${map[need[0]]}"]`); inpEl?.closest('.field')?.classList.add('need'); inpEl?.focus();
    toast(need[0] === 'amount' ? 'Add the amount first.' : need[0] === 'time' ? 'Pick a time for the reminder.' : `Fill in the ${need[0]} first.`);
    return false;
  }
  try {
    const r = await applyDraft(after);
    S.undo.push(...r.changes); S.pairs.push({ before: S.originals[d.key], after }); d.gone = true; S.done = (S.done || 0) + 1;
    S.lastLabel = r.label;
    leave(el, 'accepted');
    return true;
  } catch (e) { toast(e.message || 'Could not apply that.'); return false; }
}
function leave(el, how) {
  el.classList.add(how);
  const after = () => { el.remove(); if (!S) return; const left = S.drafts.filter(x => !x.gone).length; if (!left) S.api.close(); else updateFoot(); };
  if (motion.calm()) after(); else el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: how === 'accepted' ? 'translateY(-8px) scale(.98)' : 'translateX(24px)' }], { duration: 220, easing: 'ease-in', fill: 'forwards' }).onfinish = after;
}
function updateFoot() {
  const left = S.drafts.filter(x => !x.gone).length;
  const b = $('[data-vx="accept-all"] span'); if (b) b.textContent = `Accept ${left > 1 ? `all ${left}` : ''}`;
  const m = $('[data-testid="vx-meta"]'); if (m) m.textContent = m.textContent.replace(/^\d+ things?/, `${left} ${left === 1 ? 'thing' : 'things'}`);
}

// ---------------------------------------------------------------- events
async function onClick(e) {
  const segBtn = e.target.closest('.dcard .seg button[data-v]');
  if (segBtn) {
    const g = segBtn.parentElement; g.querySelectorAll('button').forEach(x => { x.classList.toggle('on', x === segBtn); x.setAttribute('aria-checked', String(x === segBtn)); });
    refreshEffect(segBtn.closest('.dcard')); return;
  }
  const b = e.target.closest('[data-vx]'); if (!b || !S) return;
  const act = b.dataset.vx;
  if (act === 'stop') stopRecording();
  else if (act === 'type') { S.gen = (S.gen || 0) + 1; cancelAnimationFrame(S.raf); if (S.rec && S.rec.state !== 'inactive') { S.rec.onstop = null; S.rec.stop(); } renderTyping(); }
  else if (act === 'voice') { S.text = ''; startRecording(); }
  else if (act === 'retry') understand(S.text);
  else if (act === 'edit') { const el = b.closest('.dcard'); const opening = el.classList.toggle('collapsed') === false; b.textContent = opening ? 'Done editing' : 'Edit'; b.setAttribute('aria-expanded', String(opening)); if (opening) el.querySelector('[data-f]')?.focus({ preventScroll: true }); }
  else if (act === 'discard') { const el = b.closest('.dcard'); const d = S.drafts.find(x => x.key === el.dataset.key); if (d) d.gone = true; leave(el, 'discarded'); }
  else if (act === 'discard-all') S.api.close();
  else if (act === 'accept') { b.disabled = true; if (!(await accept(b.closest('.dcard')))) b.disabled = false; }
  else if (act === 'accept-all') {
    b.disabled = true;
    for (const el of [...S.root.querySelectorAll('.dcard:not(.accepted):not(.discarded)')]) { if (!(await accept(el))) { b.disabled = false; return; } }
  }
}
function onSubmit(e) {
  e.preventDefault(); if (!S) return;
  const form = e.target.closest('[data-vx-form]'); if (!form) return;
  const t = form.querySelector('textarea')?.value.trim(); if (!t) return;
  understand(t);
}
function refreshEffect(el) {
  if (!el || !S) return; const d = S.drafts.find(x => x.key === el.dataset.key); if (!d) return;
  const p = el.querySelector('[data-effect]'); if (p) p.textContent = effect(readCard(el, d));
  if (d.type === 'complete') el.querySelector('.dc-new')?.classList.toggle('hidden', !!el.querySelector('[data-f="taskId"]').value);
}
document.addEventListener('input', e => { const el = e.target.closest?.('.dcard'); if (el) refreshEffect(el); });
document.addEventListener('change', e => { const el = e.target.closest?.('.dcard'); if (el) refreshEffect(el); });

function finish() {
  if (!S) return;
  const s = S; S = null;
  cancelAnimationFrame(s.raf);
  if (s.rec && s.rec.state !== 'inactive') { s.rec.onstop = null; s.rec.stop(); }
  releaseMic(s);
  if (!s.done) return;
  reconcileNtfy(); rearmLocal();
  sendLearning(s.pairs);
  const changes = s.undo;
  toast(s.done === 1 ? `${s.lastLabel}.` : `${s.done} changes saved.`, { undo: async () => { await undoChanges(changes); reconcileNtfy(); rearmLocal(); toast('Undone.'); } });
}

// test + keyboard hooks
window.__steadyVoice = { open: openVoice, stop: stopRecording, state: () => S?.phase || null };
