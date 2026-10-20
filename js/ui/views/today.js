import { all, get, save, remove, uid, meta, setMeta, local, setLocal } from '../../data/store.js';
import { todayKey, keyAdd, fmtTime, fmtDateKey, esc, greeting, DAYS, MONTHS, toMin } from '../../core/util.js';
import { parseQuick } from '../../core/parse.js';
import { analyze, suggestTime, mvdPicks, tinyFromGoals } from '../../data/insights.js';
import { renderDayStrip } from '../daystrip.js';
import { ring } from '../charts.js';
import { todayLine } from '../../core/voice.js';
import { I } from '../icons.js';
import { on, toast, openSheet, segmented, bindSeg, segValue, toggle, confirmSheet, requestRender } from '../ui.js';
import { reconcileNtfy, permission } from '../../platform/notify.js';
import * as motion from '../motion.js';

const ui = { showDone: false, showLater: false, showRest: false };

export function sortTasks(xs) {
  return [...xs].sort((a, b) => {
    const ta = a.dueTime ? toMin(a.dueTime) : 9999, tb = b.dueTime ? toMin(b.dueTime) : 9999;
    return ta - tb || b.priority - a.priority || a.createdAt - b.createdAt;
  });
}

export async function addTask(fields) {
  const t = await save('tasks', { id: uid(), title: '', priority: 2, dueDate: todayKey(), dueTime: null, durationMin: null, reminder: false, status: 'open', ...fields });
  if (t.reminder) reconcileNtfy();
  return t;
}

async function setStatus(id, status) {
  const t = get('tasks', id); if (!t) return;
  const prev = { ...t };
  await save('tasks', { ...t, status, doneAt: status === 'done' ? Date.now() : null });
  reconcileNtfy();
  const msg = status === 'done' ? pickDoneLine() : status === 'skipped' ? 'Skipped. That is allowed.' : 'Reopened.';
  toast(msg, { undo: () => save('tasks', { ...prev }).then(() => reconcileNtfy()) });
}

function pickDoneLine() {
  const left = all('tasks').filter(t => t.dueDate === todayKey() && t.status === 'open').length;
  if (!left) return 'That was the last one. Day done.';
  const lines = ['Done. Nice.', 'Done. One less thing.', 'Done. Keep the rhythm.', 'Checked off.'];
  return lines[Math.floor(Math.random() * lines.length)];
}

function profile() { return meta('profile'); }
function settings() { return meta('settings'); }

// ---------------- render ----------------
export function renderToday() {
  const tk = todayKey();
  const a = analyze();
  window.__lastAnalysis = a;
  const p = profile();
  const tasks = all('tasks');
  const todays = tasks.filter(t => t.dueDate === tk);
  const open = sortTasks(todays.filter(t => t.status === 'open'));
  const done = todays.filter(t => t.status !== 'open').sort((x, y) => (y.doneAt || y.updatedAt) - (x.doneAt || x.updatedAt));
  const nDone = todays.filter(t => t.status === 'done').length;
  const carry = sortTasks(tasks.filter(t => t.status === 'open' && t.dueDate < tk && !t.letGo));
  const later = sortTasks(tasks.filter(t => t.status === 'open' && t.dueDate > tk && t.dueDate <= keyAdd(tk, 7)));
  const mvdOn = local('mvdDay') === tk;
  const d = new Date();

  const sub = todayLine({ now: d, total: todays.length, done: nDone, open: open.length, a, profile: p, checkins: all('checkins'), mvd: mvdOn });

  let html = `
  <div class="page-head">
    <div>
      <div class="eyebrow">${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}</div>
      <h1 class="display">${greeting(d)}${p.name ? `, <em>${esc(p.name)}</em>` : ''}.</h1>
      <p class="sub" data-testid="today-sub">${esc(sub)}</p>
    </div>
    <div class="head-ring" data-ring="today" title="${nDone} done today">${ring(todays.length ? nDone / Math.max(1, todays.length - done.filter(t => t.status === 'skipped').length) : 0, 56)}<span>${nDone}</span></div>
  </div>

  <form class="composer card" id="composer" autocomplete="off">
    <span class="composer-plus">${I.plus}</span>
    <input id="qa" data-keep name="qa" placeholder="Add a task… e.g. gym 7pm 45m" aria-label="Add a task" enterkeyhint="done">
    <button class="btn primary sm" type="submit" id="qa-add">Add</button>
    <div class="chips" id="qa-chips" aria-live="polite"></div>
  </form>`;

  // the day at a glance: next timed thing + the waking day as a line (only when something today has a time)
  html += renderDayStrip(todays, { wake: p.wake || '07:00', sleep: p.sleep || '23:30' });

  // carry-over prompt
  const slumpCard = a.slump && !mvdOn && local('mvdDismissed') !== tk && (open.length || !todays.length);
  if (carry.length && !slumpCard) {
    html += `<section class="card soft prompt" data-testid="carry">
      <div class="prompt-icon">${I.carry}</div>
      <div class="prompt-body">
        <h2 class="prompt-title">${carry.length === 1 ? 'One thing' : `${carry.length} things`} from before ${carry.length === 1 ? 'is' : 'are'} still open.</h2>
        <p class="muted">${carry.slice(0, 3).map(t => esc(t.title)).join(' · ')}${carry.length > 3 ? ` · +${carry.length - 3}` : ''}</p>
        <div class="row gap wrap">
          <button class="btn primary sm" data-act="carry-all">Bring ${carry.length === 1 ? 'it' : 'them'} to today</button>
          <button class="btn ghost sm" data-act="carry-pick">Choose</button>
          <button class="btn ghost sm" data-act="carry-letgo">Let ${carry.length === 1 ? 'it' : 'them'} go</button>
        </div>
      </div></section>`;
  }

  // adaptive: slump -> minimum viable day; heavy plan -> lighten
  if (a.slump && !mvdOn && open.length !== 0 && local('mvdDismissed') !== tk) {
    html += `<section class="card accent-soft prompt" data-testid="mvd-offer">
      <div class="prompt-icon">${I.leaf}</div>
      <div class="prompt-body">
        <h2 class="prompt-title">${esc(a.slump.text)} Let's make today small.</h2>
        <p class="muted">Just ${Math.min(3, open.length) || 2} tiny things. The rest waits.</p>
        <div class="row gap wrap"><button class="btn primary sm" data-act="mvd-on">Make it a small day</button><button class="btn ghost sm" data-act="mvd-dismiss">I'm good</button></div>
      </div></section>`;
  } else if (a.slump && !mvdOn && !open.length && !todays.length) {
    const tiny = tinyFromGoals();
    html += `<section class="card accent-soft prompt" data-testid="mvd-offer">
      <div class="prompt-icon">${I.leaf}</div>
      <div class="prompt-body">
        <h2 class="prompt-title">${esc(a.slump.text)}</h2>
        <p class="muted">Start tiny. Pick one:</p>
        <div class="row gap wrap">${tiny.map(t => `<button class="chip-btn" data-act="add-tiny" data-title="${esc(t)}">${I.plus}<span>${esc(t)}</span></button>`).join('')}</div>
      </div></section>`;
  } else if (!mvdOn && open.length > a.loadCap && a.enough && local('loadDismissed') !== tk) {
    html += `<section class="card soft prompt" data-testid="load-hint">
      <div class="prompt-icon">${I.spark}</div>
      <div class="prompt-body">
        <h2 class="prompt-title">${open.length} open today. You usually finish about ${Math.max(1, Math.round(a.avgDone))}.</h2>
        <p class="muted">Want to move the ${open.length - a.loadCap} lowest-priority ${open.length - a.loadCap === 1 ? 'one' : 'ones'} to tomorrow?</p>
        <div class="row gap wrap"><button class="btn primary sm" data-act="lighten">Lighten today</button><button class="btn ghost sm" data-act="load-dismiss">Keep it</button></div>
      </div></section>`;
  }

  // install banner
  if (window.__installPrompt && !local('installDismissed')) {
    html += `<section class="card soft prompt slim"><div class="prompt-icon">${I.phone}</div><div class="prompt-body row between wrap gap"><span>Install Steady for one-tap access and offline use.</span><span class="row gap"><button class="btn primary sm" data-act="install">Install</button><button class="btn ghost sm" data-act="install-dismiss">Later</button></span></div></section>`;
  }

  // list
  if (mvdOn && open.length) {
    const picks = mvdPicks(open);
    const rest = open.filter(t => !picks.includes(t));
    html += `<section class="list-sec"><div class="sec-head" data-k="sh-mvd"><h2>Just these today</h2><button class="link" data-act="mvd-off">Show full day</button></div>
      <ul class="tasks" data-testid="open-list">${picks.map(t => taskRow(t)).join('')}</ul>
      ${rest.length ? `<button class="disclose" data-k="d-rest" data-act="toggle-rest" aria-expanded="${ui.showRest}">Everything else can wait · ${rest.length}</button>${ui.showRest ? `<ul class="tasks dim">${rest.map(t => taskRow(t)).join('')}</ul>` : ''}` : ''}
    </section>`;
  } else if (open.length) {
    html += `<section class="list-sec"><div class="sec-head" data-k="sh-today"><h2>Today</h2><span class="count">${open.length} open</span></div><ul class="tasks" data-testid="open-list">${open.map(t => taskRow(t)).join('')}</ul></section>`;
  } else if (!todays.length) {
    const acts = all('goals').flatMap(g => (g.actions || []).slice(0, 2).map(x => ({ g, x }))).slice(0, 4);
    html += `<section class="empty" data-testid="empty-today">
      <p class="serif big">A clear page.</p>
      <p class="muted">Add one small thing above.</p>
      ${acts.length ? `<div class="row gap wrap center">${acts.map(({ g, x }) => `<button class="chip-btn" data-act="add-action" data-goal="${g.id}" data-title="${esc(x.title)}">${I.plus}<span>${esc(x.title)}</span></button>`).join('')}</div>` : ''}
    </section>`;
  } else {
    html += `<section class="empty small"><p class="serif big">That's the day.</p><p class="muted">${a.streak.current >= 2 ? `${a.streak.current} days in a row now.` : 'Be proud of that, and rest.'}</p></section>`;
  }

  if (done.length) {
    html += `<section class="list-sec"><button class="disclose" data-k="d-done" data-act="toggle-done" aria-expanded="${ui.showDone}">Done & skipped · ${done.length}</button>
      ${ui.showDone ? `<ul class="tasks done-list" data-testid="done-list">${done.map(t => taskRow(t)).join('')}</ul>` : ''}</section>`;
  }
  if (later.length) {
    html += `<section class="list-sec"><button class="disclose" data-k="d-later" data-act="toggle-later" aria-expanded="${ui.showLater}">Coming up this week · ${later.length}</button>
      ${ui.showLater ? `<ul class="tasks">${later.map(t => taskRow(t, true)).join('')}</ul>` : ''}</section>`;
  }
  return html;
}

function taskRow(t, showDate = false) {
  const goal = t.goalId ? get('goals', t.goalId) : null;
  const meta = [
    showDate ? fmtDateKey(t.dueDate) : null,
    t.dueTime ? `${t.reminder ? I.bell : ''}${fmtTime(t.dueTime)}` : null,
    t.durationMin ? `${t.durationMin} min` : null,
    goal ? `<span class="goal-tag">${esc(goal.title)}</span>` : null,
    t.carried ? 'carried over' : null,
    t.status === 'skipped' ? 'skipped' : null,
  ].filter(Boolean);
  return `<li class="task p${t.priority} ${t.status}" data-id="${t.id}">
    <button class="check" data-act="toggle" aria-label="${t.status === 'done' ? 'Mark not done' : 'Mark done'}: ${esc(t.title)}">${I.check}</button>
    <button class="t-main" data-act="edit" title="Edit"><span class="t-title">${esc(t.title)}</span>${meta.length ? `<span class="t-meta">${meta.map(m => `<span>${m}</span>`).join('')}</span>` : ''}</button>
    ${t.status === 'open' ? `<button class="icon-btn subtle" data-act="skip" aria-label="Skip ${esc(t.title)}" title="Skip">${I.skip}</button>` : ''}
  </li>`;
}

// ---------------- composer ----------------
let stripTimer = null;
export function mountToday(root) {
  // the strip's countdown and "now" marker move every 30 s without re-rendering the page
  clearInterval(stripTimer);
  stripTimer = setInterval(() => {
    const el = document.getElementById('daystrip');
    if (!el) { if (!document.querySelector('.v-today')) clearInterval(stripTimer); return; }
    const p = profile();
    const html = renderDayStrip(all('tasks').filter(t => t.dueDate === todayKey()), { wake: p.wake || '07:00', sleep: p.sleep || '23:30' });
    if (!html) { el.remove(); return; }
    const tmp = document.createElement('div'); tmp.innerHTML = html;
    if (tmp.firstElementChild.innerHTML !== el.innerHTML) el.replaceWith(tmp.firstElementChild);
  }, 30e3);
  const input = root.querySelector('#qa');
  const chips = root.querySelector('#qa-chips');
  if (!input) return;
  const p = profile();
  const opts = () => ({ wake: p.wake || '07:00', sleep: p.sleep || '23:30', defaultReminder: settings().defaultReminder !== false, goals: all('goals') });
  const preview = () => {
    const v = input.value.trim();
    if (!v) { chips.innerHTML = ''; chips.classList.remove('show'); return; }
    const r = parseQuick(v, opts());
    const prevTexts = new Set([...chips.querySelectorAll('.chip')].map(c => c.textContent));
    const wasShown = chips.classList.contains('show');
    let html = `<span class="chip title">${esc(r.title)}</span>` + r.chips.map(c => `<span class="chip k-${c.k}">${esc(c.label)}</span>`).join('');
    if (!r.dueTime) { const sg = suggestTime(r.title); if (sg) html += `<button type="button" class="chip suggest" data-time="${sg.time}">+ ${fmtTime(sg.time)}, ${esc(sg.why)}</button>`; }
    chips.innerHTML = html; chips.classList.add('show');
    if (wasShown) { const t = chips.querySelector('.chip.title'); if (t) prevTexts.add(t.textContent); }
    motion.popNew(chips, prevTexts);
  };
  input.addEventListener('input', preview);
  preview();
  chips.addEventListener('click', e => {
    const b = e.target.closest('.suggest'); if (!b) return;
    input.value = `${input.value.trim()} at ${b.dataset.time}`; preview(); input.focus();
  });
  root.querySelector('#composer').addEventListener('submit', async e => {
    e.preventDefault();
    const v = input.value.trim(); if (!v) { input.focus(); return; }
    const r = parseQuick(v, opts());
    input.value = ''; preview();
    await addTask({ title: r.title, priority: r.priority, dueDate: r.dueDate, dueTime: r.dueTime, durationMin: r.durationMin, reminder: r.reminder, goalId: r.goalId });
    toast(r.dueDate === todayKey() ? 'Added to today.' : `Added for ${fmtDateKey(r.dueDate)}.`);
    if (r.reminder && permission() === 'default' && !local('notifAsked')) setTimeout(() => window.__askNotifications?.(), 400);
    setTimeout(() => document.getElementById('qa')?.focus(), 30);
  });
}

// ---------------- actions ----------------
const idOf = el => el.closest('[data-id]')?.dataset.id;
on('toggle', el => {
  const t = get('tasks', idOf(el)); if (!t) return;
  const li = el.closest('.task');
  if (li?.classList.contains('completing')) return;
  if (t.status === 'open') { motion.complete(li); motion.hold(440); }
  setStatus(t.id, t.status === 'open' ? 'done' : 'open');
});
on('skip', el => { const li = el.closest('.task'); if (li) li.dataset.exit = 'right'; setStatus(idOf(el), 'skipped'); });
on('edit', el => editTask(idOf(el)));
on('toggle-done', () => { ui.showDone = !ui.showDone; requestRender(); });
on('toggle-later', () => { ui.showLater = !ui.showLater; requestRender(); });
on('toggle-rest', () => { ui.showRest = !ui.showRest; requestRender(); });
on('mvd-on', async () => { await setLocal('mvdDay', todayKey()); requestRender(); toast('Small day it is. Three things, max.'); });
on('mvd-off', async () => { await setLocal('mvdDay', null); requestRender(); });
on('mvd-dismiss', async () => { await setLocal('mvdDismissed', todayKey()); requestRender(); });
on('load-dismiss', async () => { await setLocal('loadDismissed', todayKey()); requestRender(); });
on('add-tiny', async el => { await addTask({ title: el.dataset.title, durationMin: 5, priority: 2, mvd: true }); await setLocal('mvdDay', todayKey()); });
on('add-action', async el => { await addTask({ title: el.dataset.title, goalId: el.dataset.goal }); toast('Added to today.'); });
on('install-dismiss', async () => { await setLocal('installDismissed', true); requestRender(); });
on('lighten', async () => {
  const a = analyze();
  const open = all('tasks').filter(t => t.dueDate === todayKey() && t.status === 'open')
    .sort((x, y) => x.priority - y.priority || (y.durationMin || 0) - (x.durationMin || 0));
  const move = open.slice(0, Math.max(0, open.length - a.loadCap));
  for (const t of move) await save('tasks', { ...t, dueDate: keyAdd(todayKey(), 1) });
  reconcileNtfy();
  toast(`Moved ${move.length} to tomorrow.`);
});
on('carry-all', async () => {
  const tk = todayKey();
  const xs = all('tasks').filter(t => t.status === 'open' && t.dueDate < tk && !t.letGo);
  for (const t of xs) await save('tasks', { ...t, dueDate: tk, carried: true });
  reconcileNtfy();
  toast(`Brought ${xs.length} into today.`);
});
on('carry-letgo', async () => {
  const tk = todayKey();
  const xs = all('tasks').filter(t => t.status === 'open' && t.dueDate < tk && !t.letGo);
  for (const t of xs) await save('tasks', { ...t, status: 'skipped', letGo: true });
  toast('Let go. Fresh start.', { undo: async () => { for (const t of xs) await save('tasks', { ...t }); } });
});
on('carry-pick', () => {
  const tk = todayKey();
  const xs = sortTasks(all('tasks').filter(t => t.status === 'open' && t.dueDate < tk && !t.letGo));
  openSheet({
    title: 'Bring forward',
    body: `<p class="muted">Tick what still matters. The rest goes quietly.</p>
      <ul class="pick-list">${xs.map(t => `<li><label class="pick"><input type="checkbox" value="${t.id}" checked><span>${esc(t.title)}<small>${fmtDateKey(t.dueDate)}</small></span></label></li>`).join('')}</ul>
      <div class="row end gap"><button class="btn primary" data-ok>Done</button></div>`,
    onMount: (b, api) => b.querySelector('[data-ok]').onclick = async () => {
      for (const cb of b.querySelectorAll('input[type=checkbox]')) {
        const t = get('tasks', cb.value);
        if (cb.checked) await save('tasks', { ...t, dueDate: tk, carried: true });
        else await save('tasks', { ...t, status: 'skipped', letGo: true });
      }
      reconcileNtfy(); api.close();
    },
  });
});

export function editTask(id, preset = {}) {
  const t = id ? get('tasks', id) : { id: null, title: '', priority: 2, dueDate: todayKey(), dueTime: null, durationMin: null, reminder: false, ...preset };
  if (!t) return;
  const goals = all('goals');
  const sg = suggestTime(t.title);
  openSheet({
    title: id ? 'Edit task' : 'New task',
    body: `<form class="form" id="tf">
      <label class="field"><span>Task</span><input name="title" value="${esc(t.title)}" required autofocus></label>
      <div class="grid2">
        <label class="field"><span>Day</span><input type="date" name="dueDate" value="${t.dueDate}"></label>
        <label class="field"><span>Time</span><input type="time" name="dueTime" value="${t.dueTime || ''}"></label>
      </div>
      ${sg && !t.dueTime ? `<button type="button" class="chip suggest" data-sg="${sg.time}">Suggested ${fmtTime(sg.time)}, ${esc(sg.why)}</button>` : ''}
      <div class="grid2">
        <label class="field"><span>Minutes</span><input type="number" name="durationMin" min="1" max="600" inputmode="numeric" value="${t.durationMin || ''}" placeholder="—"></label>
        <label class="field"><span>Goal</span><select name="goalId"><option value="">None</option>${goals.map(g => `<option value="${g.id}" ${g.id === t.goalId ? 'selected' : ''}>${esc(g.title)}</option>`).join('')}</select></label>
      </div>
      <div class="field"><span>Priority</span>${segmented('prio', [[1, 'Low'], [2, 'Normal'], [3, 'High']], t.priority)}</div>
      ${toggle('t-rem', t.reminder, 'Remind me at the time')}
      <div class="row between gap wrap form-actions">
        <div class="row gap">${id ? `<button type="button" class="btn ghost sm" data-move>Tomorrow</button><button type="button" class="btn ghost sm danger-text" data-del>${I.trash}<span>Delete</span></button>` : ''}</div>
        <button class="btn primary" type="submit">Save</button>
      </div></form>`,
    onMount: (b, api) => {
      const f = b.querySelector('#tf');
      bindSeg(b, 'prio', () => {});
      b.querySelector('[data-sg]')?.addEventListener('click', e => { f.dueTime.value = e.currentTarget.dataset.sg; b.querySelector('#t-rem').checked = true; e.currentTarget.remove(); });
      f.addEventListener('submit', async e => {
        e.preventDefault();
        const rec = { ...t, title: f.title.value.trim() || t.title, dueDate: f.dueDate.value || todayKey(), dueTime: f.dueTime.value || null,
          durationMin: f.durationMin.value ? +f.durationMin.value : null, goalId: f.goalId.value || null,
          priority: +segValue(b, 'prio') || 2, reminder: b.querySelector('#t-rem').checked };
        if (!rec.dueTime) rec.reminder = false;
        if (id) await save('tasks', rec); else await addTask({ ...rec, id: uid() });
        reconcileNtfy(); api.close();
      });
      b.querySelector('[data-move]')?.addEventListener('click', async () => { await save('tasks', { ...t, dueDate: keyAdd(todayKey(), 1), status: 'open' }); reconcileNtfy(); api.close(); toast('Moved to tomorrow.'); });
      b.querySelector('[data-del]')?.addEventListener('click', async () => {
        const prev = await remove('tasks', t.id); reconcileNtfy(); api.close();
        toast('Deleted.', { undo: () => save('tasks', prev) });
      });
    },
  });
}
