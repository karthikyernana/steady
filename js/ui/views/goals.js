import { all, get, save, remove, uid } from '../../data/store.js';
import { todayKey, keyAdd, dateKey, weekStart, addDays, fmtDateKey, esc, MONTHS } from '../../core/util.js';
import { I } from '../icons.js';
import { on, openSheet, toast, confirmSheet } from '../ui.js';
import { addTask } from './today.js';
import * as motion from '../motion.js';

const thisWeek = () => dateKey(weekStart());
const weekLabel = k => { if (!k) return 'Unscheduled'; if (k === thisWeek()) return 'This week'; if (k === keyAdd(thisWeek(), 7)) return 'Next week'; if (k === keyAdd(thisWeek(), -7)) return 'Last week'; const d = new Date(k + 'T00:00'); return `Week of ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; };

export function goalProgress(g) {
  const ms = g.milestones || [];
  return ms.length ? ms.filter(m => m.done).length / ms.length : 0;
}

export function renderGoals() {
  const goals = all('goals').sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt));
  const tasks = all('tasks');
  const ws = thisWeek();
  let html = `<div class="page-head"><div><div class="eyebrow">Goals</div><h1 class="display">What you're <em>building</em>.</h1></div></div>`;
  if (!goals.length) {
    html += `<section class="empty"><p class="serif big">No goals yet.</p><p class="muted">One thing you want true in three months.</p><button class="btn primary" data-act="goal-new">${I.plus}<span>Add a goal</span></button></section>`;
    return html;
  }
  html += '<div class="goal-list">';
  for (const g of goals) {
    const ms = g.milestones || [];
    const p = goalProgress(g);
    const current = ms.find(m => !m.done && (m.week || '') <= ws) || ms.find(m => !m.done);
    const weekDone = tasks.filter(t => t.goalId === g.id && t.status === 'done' && t.doneAt && dateKey(new Date(t.doneAt)) >= ws).length;
    html += `<article class="card goal" data-id="${g.id}">
      <div class="goal-top"><div><h2 class="serif goal-title">${esc(g.title)}</h2>${g.why ? `<p class="muted why">${esc(g.why)}</p>` : ''}</div>
        <button class="icon-btn" data-act="goal-edit" aria-label="Edit goal ${esc(g.title)}">${I.more}</button></div>
      <div class="progress" role="progressbar" aria-label="Milestones done for ${esc(g.title)}" aria-valuenow="${Math.round(p * 100)}" aria-valuemin="0" aria-valuemax="100"><span data-p="${(p * 100).toFixed(1)}" style="width:${(p * 100).toFixed(1)}%"></span></div>
      <div class="row between small muted"><span>${ms.length ? `${ms.filter(m => m.done).length} of ${ms.length} milestones` : 'No milestones yet'}</span><span>${g.target ? `by ${fmtDateKey(g.target, { relative: false })}` : ''}</span></div>
      ${current ? `<div class="milestone-now"><button class="check sm ${current.done ? 'on' : ''}" data-act="ms-toggle" data-ms="${current.id}" aria-label="Complete milestone ${esc(current.title)}">${I.check}</button><div><div class="eyebrow">${weekLabel(current.week)}</div><div>${esc(current.title)}</div></div></div>` : ms.length ? '<p class="small accent">All milestones done. Time to set the next ones.</p>' : `<button class="link" data-act="goal-edit">Plan weekly milestones ${I.arrow}</button>`}
      ${(g.actions || []).length ? `<div class="actions-list"><div class="eyebrow">Daily actions · ${weekDone} done this week</div>${g.actions.map(a => {
        const onToday = tasks.some(t => t.goalId === g.id && t.dueDate === todayKey() && t.title === a.title);
        return `<div class="action-row"><span>${esc(a.title)}</span>${onToday ? '<span class="small muted">On today</span>' : `<button class="chip-btn sm" data-act="action-today" data-aid="${a.id}">${I.plus}<span>Today</span></button>`}</div>`;
      }).join('')}</div>` : ''}
    </article>`;
  }
  html += `</div><div class="row center"><button class="btn ghost" data-act="goal-new">${I.plus}<span>Add a goal</span></button></div>`;
  return html;
}

const gid = el => el.closest('[data-id]')?.dataset.id;
on('goal-new', () => editGoal(null));
on('goal-edit', el => editGoal(gid(el)));
on('ms-toggle', async el => {
  const g = get('goals', gid(el)); const id = el.dataset.ms;
  if (!g.milestones.find(m => m.id === id)?.done) { el.classList.add('on'); motion.burst(el); motion.hold(420); navigator.vibrate?.(8); }
  const milestones = g.milestones.map(m => (m.id === id ? { ...m, done: !m.done, doneAt: !m.done ? Date.now() : null } : m));
  await save('goals', { ...g, milestones });
  toast('Milestone done. That is real progress.');
});
on('action-today', async el => {
  const g = get('goals', gid(el)); const a = g.actions.find(x => x.id === el.dataset.aid);
  await addTask({ title: a.title, goalId: g.id, durationMin: a.durationMin || null });
  toast('Added to today.');
});

export function editGoal(id) {
  const g = id ? get('goals', id) : { id: uid(), title: '', why: '', target: dateKey(addDays(new Date(), 84)), milestones: [], actions: [] };
  const state = { milestones: (g.milestones || []).map(m => ({ ...m })), actions: (g.actions || []).map(a => ({ ...a })) };
  const weeks = [...Array(16)].map((_, i) => keyAdd(thisWeek(), i * 7));
  const msRows = () => state.milestones.map((m, i) => `<li class="edit-row"><button type="button" class="check sm ${m.done ? 'on' : ''}" data-msi="${i}" aria-label="Toggle">${I.check}</button>
      <input value="${esc(m.title)}" data-mst="${i}" aria-label="Milestone">
      <select data-msw="${i}" aria-label="Week">${weeks.concat(m.week && !weeks.includes(m.week) ? [m.week] : []).map(w => `<option value="${w}" ${w === m.week ? 'selected' : ''}>${weekLabel(w)}</option>`).join('')}</select>
      <button type="button" class="icon-btn subtle" data-msx="${i}" aria-label="Remove">${I.close}</button></li>`).join('');
  const acRows = () => state.actions.map((a, i) => `<li class="edit-row"><input value="${esc(a.title)}" data-act-t="${i}" aria-label="Daily action"><button type="button" class="icon-btn subtle" data-acx="${i}" aria-label="Remove">${I.close}</button></li>`).join('');
  openSheet({
    title: id ? 'Edit goal' : 'New goal', cls: 'tall',
    body: `<form class="form" id="gf">
      <label class="field"><span>Goal</span><input name="title" value="${esc(g.title)}" placeholder="Land a paid freelance client" required autofocus></label>
      <label class="field"><span>Why it matters</span><input name="why" value="${esc(g.why || '')}" placeholder="Independence, proof I can sell"></label>
      <label class="field"><span>Target date</span><input type="date" name="target" value="${g.target || ''}"></label>
      <div class="field"><span>Weekly milestones</span><ul class="edit-list" id="msl">${msRows()}</ul>
        <div class="add-row"><input id="ms-new" placeholder="Add a milestone, e.g. ship portfolio v1"><button type="button" class="btn ghost sm" id="ms-add">Add</button></div></div>
      <div class="field"><span>Daily small actions</span><ul class="edit-list" id="acl">${acRows()}</ul>
        <div class="add-row"><input id="ac-new" placeholder="e.g. send 3 cold DMs"><button type="button" class="btn ghost sm" id="ac-add">Add</button></div></div>
      <div class="row between gap form-actions">${id ? `<button type="button" class="btn ghost sm danger-text" data-del>${I.trash}<span>Delete goal</span></button>` : '<span></span>'}<button class="btn primary" type="submit">Save goal</button></div>
    </form>`,
    onMount: (b, api) => {
      const f = b.querySelector('#gf');
      const sync = () => {
        b.querySelectorAll('[data-mst]').forEach(x => { state.milestones[+x.dataset.mst].title = x.value; });
        b.querySelectorAll('[data-msw]').forEach(x => { state.milestones[+x.dataset.msw].week = x.value; });
        b.querySelectorAll('[data-act-t]').forEach(x => { state.actions[+x.dataset.actT].title = x.value; });
      };
      const redraw = () => { b.querySelector('#msl').innerHTML = msRows(); b.querySelector('#acl').innerHTML = acRows(); };
      const nextWeek = () => { const used = new Set(state.milestones.map(m => m.week)); return weeks.find(w => !used.has(w)) || weeks[weeks.length - 1]; };
      const addMs = () => { const v = b.querySelector('#ms-new').value.trim(); if (!v) return; sync(); state.milestones.push({ id: uid(), title: v, week: nextWeek(), done: false }); b.querySelector('#ms-new').value = ''; redraw(); b.querySelector('#ms-new').focus(); };
      const addAc = () => { const v = b.querySelector('#ac-new').value.trim(); if (!v) return; sync(); state.actions.push({ id: uid(), title: v }); b.querySelector('#ac-new').value = ''; redraw(); b.querySelector('#ac-new').focus(); };
      b.querySelector('#ms-add').onclick = addMs; b.querySelector('#ac-add').onclick = addAc;
      b.querySelector('#ms-new').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addMs(); } });
      b.querySelector('#ac-new').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addAc(); } });
      b.addEventListener('click', e => {
        const t = e.target.closest('[data-msi],[data-msx],[data-acx]'); if (!t) return;
        sync();
        if (t.dataset.msi) { const m = state.milestones[+t.dataset.msi]; m.done = !m.done; }
        if (t.dataset.msx) state.milestones.splice(+t.dataset.msx, 1);
        if (t.dataset.acx) state.actions.splice(+t.dataset.acx, 1);
        redraw();
      });
      f.addEventListener('submit', async e => {
        e.preventDefault(); sync();
        // also capture any text left in the "add" boxes
        const pm = b.querySelector('#ms-new').value.trim(); if (pm) state.milestones.push({ id: uid(), title: pm, week: nextWeek(), done: false });
        const pa = b.querySelector('#ac-new').value.trim(); if (pa) state.actions.push({ id: uid(), title: pa });
        state.milestones.sort((x, y) => (x.week || '').localeCompare(y.week || ''));
        await save('goals', { ...g, title: f.title.value.trim(), why: f.why.value.trim(), target: f.target.value || null,
          milestones: state.milestones.filter(m => m.title.trim()), actions: state.actions.filter(a => a.title.trim()) });
        api.close(); toast(id ? 'Goal updated.' : 'Goal added. One week at a time.');
      });
      b.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (!(await confirmSheet(`Delete “${g.title}”? Tasks linked to it stay.`, 'Delete goal', true))) return;
        const prev = await remove('goals', g.id); api.close(); toast('Goal deleted.', { undo: () => save('goals', prev) });
      });
    },
  });
}
