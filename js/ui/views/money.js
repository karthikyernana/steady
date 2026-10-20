import { all, get, save, remove, uid, meta, setMeta } from '../../data/store.js';
import { todayKey, fmtDateKey, esc } from '../../core/util.js';
import { fmtINR, monthKey, monthAdd, monthLabel, summarize, moneyLine, parseMoney, canonicalCategory, DEFAULT_CATEGORIES, INCOME_CATEGORIES } from '../../core/money.js';
import { bars } from '../charts.js';
import { I } from '../icons.js';
import { on, toast, openSheet, segmented, bindSeg, segValue, requestRender } from '../ui.js';
import * as motion from '../motion.js';

const ui = { month: null, showAll: false };
const curMonth = () => ui.month || monthKey();
const budgets = () => { const b = meta('budgets'); return { total: +b.total || 0, categories: b.categories || {} }; };
export const knownCategories = () => {
  const n = new Map(); for (const m of all('money')) n.set(m.category, (n.get(m.category) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1]).map(([c]) => c);
};
const memoryLite = () => {   // on-device learning for quick-add: payee → category from your own past entries
  const payees = {}; for (const m of all('money')) if (m.payee) payees[m.payee.toLowerCase()] = { name: m.payee, category: m.category };
  return { payees, corrections: [] };
};

export function renderMoney() {
  const mk = curMonth(), entries = all('money');
  const sum = summarize(entries, mk, { budgets: budgets() });
  const prev = summarize(entries, monthAdd(mk, -1));
  const isNow = mk === monthKey();
  const list = entries.filter(e => typeof e.date === 'string' && e.date.startsWith(mk)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  let html = `<div class="page-head"><div><div class="eyebrow">Money</div><h1 class="display">Where it <em>goes</em>.</h1>
    <p class="sub" data-testid="money-sub">${esc(moneyLine(sum, prev))}</p></div></div>

  <form class="composer card" id="m-composer" autocomplete="off">
    <span class="composer-plus">${I.plus}</span>
    <input id="mq" data-keep name="mq" placeholder="Add… e.g. 250 lunch swiggy" aria-label="Add income or expense" enterkeyhint="done">
    <button class="btn primary sm" type="submit">Add</button>
    <div class="chips" id="mq-chips" aria-live="polite"></div>
  </form>

  <div class="month-nav" data-k="month-nav">
    <button class="icon-btn" data-act="m-month" data-d="-1" aria-label="Previous month">${I.left}</button>
    <h2 class="month-title" data-testid="money-month">${esc(monthLabel(mk))}</h2>
    <button class="icon-btn" data-act="m-month" data-d="1" aria-label="Next month" ${isNow ? 'disabled' : ''}>${I.right}</button>
  </div>

  <div class="stats money-stats">
    <div class="stat card"><span class="stat-n serif" data-testid="money-spent">${fmtINR(sum.spent)}</span><span class="stat-l">spent</span></div>
    <div class="stat card"><span class="stat-n serif accent">${fmtINR(sum.income)}</span><span class="stat-l">came in</span></div>
    <div class="stat card"><span class="stat-n serif">${sum.net < 0 ? '−' : ''}${fmtINR(Math.abs(sum.net))}</span><span class="stat-l">net</span></div>
    <div class="stat card"><span class="stat-n serif">${fmtINR(Math.round(sum.avgPerDay))}</span><span class="stat-l">a day on average</span></div>
  </div>`;

  const b = sum.budget;
  if (b) {
    html += `<section class="card" data-testid="budget-card"><div class="row between"><h2 class="card-title">${I.spark}<span>Budget</span></h2><button class="link" data-act="m-budget">Edit</button></div>
      ${[b.total, ...b.categories].filter(Boolean).map(l => budgetRow(l)).join('')}</section>`;
  }

  if (sum.cats.length) {
    html += `<div class="two-col money-two">
      <section class="card"><div class="row between"><h2 class="card-title">By category</h2>${b ? '' : '<button class="link" data-act="m-budget">Set a budget</button>'}</div>
        <ul class="cat-list">${sum.cats.slice(0, 8).map(c => `<li data-k="cat-${esc(c.category)}"><div class="row between"><span>${esc(c.category)}</span><span class="small"><strong>${fmtINR(c.amount)}</strong> <span class="muted">${Math.round(c.share * 100)}%</span></span></div>
          <div class="progress thin"><span data-p="${(c.share * 100).toFixed(1)}" style="width:${(c.share * 100).toFixed(1)}%"></span></div></li>`).join('')}</ul></section>
      <section class="card chart-card"><h2 class="card-title">Day by day</h2><p class="muted small">Spending each day of ${esc(monthLabel(mk).split(' ')[0])}.</p>
        <div class="chart-wrap">${bars(sum.byDay.map((v, i) => (isNow && i + 1 > new Date().getDate() ? null : v)), sum.byDay.map((_, i) => String(i + 1)),
          { highlight: isNow ? new Date().getDate() - 1 : -1, fmt: v => fmtINR(v), emptyLabel: 'not yet', label: 'Spending by day', height: 110 })}</div></section>
    </div>`;
  }

  if (!list.length) {
    html += `<section class="empty" data-testid="money-empty"><p class="serif big">${entries.length ? 'Nothing this month.' : 'No money logged yet.'}</p>
      <p class="muted">Type “250 lunch swiggy” above, or say it.</p></section>`;
    return html;
  }
  const shown = ui.showAll ? list : list.slice(0, 40);
  let last = '';
  html += '<section class="list-sec"><div class="sec-head" data-k="sh-money"><h2>Entries</h2><span class="count">' + list.length + '</span></div><ul class="money-list" data-testid="money-list">';
  for (const e of shown) {
    if (e.date !== last) { const dayTotal = list.filter(x => x.date === e.date && x.kind !== 'income').reduce((a, x) => a + x.amount, 0); html += `<li class="day-label row between" data-k="md-${esc(e.date)}"><span>${esc(fmtDateKey(e.date))}</span>${dayTotal ? `<span>${fmtINR(dayTotal)}</span>` : ''}</li>`; last = e.date; }
    html += `<li class="mrow ${e.kind === 'income' ? 'income' : 'expense'}" data-id="${esc(e.id)}"><button class="m-main" data-act="m-edit">
      <span class="m-ic" aria-hidden="true">${e.kind === 'income' ? I.income : I.expense}</span>
      <span class="m-text"><span class="m-title">${esc(e.note || e.payee || e.category)}</span><span class="m-meta">${esc([e.category, e.payee && e.payee !== e.note ? e.payee : null].filter(Boolean).join(' · '))}${e.source === 'voice' ? ` · ${I.mic}` : ''}</span></span>
      <span class="m-amt">${e.kind === 'income' ? '+' : ''}${fmtINR(e.amount)}</span></button></li>`;
  }
  html += '</ul>';
  if (list.length > shown.length) html += `<button class="disclose" data-act="m-all" aria-expanded="false">Show all ${list.length}</button>`;
  return html + '</section>';
}

function budgetRow(l) {
  const over = l.left < 0, f = Math.min(1, l.frac);
  return `<div class="budget-row ${over ? 'over' : l.pace > 0.1 ? 'ahead' : ''}" data-k="b-${esc(l.category)}"><div class="row between small"><span>${esc(l.category)}</span>
    <span>${fmtINR(l.used)} <span class="muted">of ${fmtINR(l.limit)}</span></span></div>
    <div class="progress thin"><span data-p="${(f * 100).toFixed(1)}" style="width:${(f * 100).toFixed(1)}%"></span></div>
    <small class="hint">${over ? `${fmtINR(-l.left)} over` : `${fmtINR(l.left)} left`}${!over && l.pace > 0.1 ? ', a little ahead of the month' : ''}</small></div>`;
}

export function mountMoney(root) {
  const input = root.querySelector('#mq'), chips = root.querySelector('#mq-chips');
  if (!input) return;
  const opts = () => ({ memory: memoryLite(), known: knownCategories() });
  const preview = () => {
    const v = input.value.trim();
    if (!v) { chips.innerHTML = ''; chips.classList.remove('show'); return; }
    const r = parseMoney(v, opts());
    const prevTexts = new Set([...chips.querySelectorAll('.chip')].map(c => c.textContent));
    chips.innerHTML = (r.amount == null ? '<span class="chip k-warn">Add an amount</span>' : '') + `<span class="chip title">${esc(r.note || r.category)}</span>` + r.chips.map(c => `<span class="chip k-${c.k}">${esc(c.label)}</span>`).join('');
    chips.classList.add('show'); motion.popNew(chips, prevTexts);
  };
  input.addEventListener('input', preview); preview();
  root.querySelector('#m-composer').addEventListener('submit', async e => {
    e.preventDefault();
    const v = input.value.trim(); if (!v) { input.focus(); return; }
    const r = parseMoney(v, opts());
    if (r.amount == null) { editEntry(null, { kind: r.kind, category: r.category, note: r.note, payee: r.payee, date: r.date }); return; }
    input.value = ''; preview();
    const rec = await save('money', { id: uid(), kind: r.kind, amount: r.amount, category: r.category, payee: r.payee, note: r.note, date: r.date, source: 'typed' });
    if (!rec.date.startsWith(curMonth())) ui.month = rec.date.slice(0, 7);
    toast(`${r.kind === 'income' ? 'Income' : 'Expense'} logged: ${fmtINR(r.amount)}.`, { undo: () => remove('money', rec.id) });
  });
}

on('m-month', el => { const d = +el.dataset.d; const n = monthAdd(curMonth(), d); if (n > monthKey()) return; ui.month = n === monthKey() ? null : n; requestRender(); });
on('m-all', () => { ui.showAll = true; requestRender(); });
on('m-edit', el => editEntry(el.closest('[data-id]').dataset.id));
on('m-budget', () => editBudget());

export function editEntry(id, preset = {}) {
  const e = id ? get('money', id) : { id: null, kind: 'expense', amount: null, category: 'Other', note: '', payee: null, date: todayKey(), ...preset };
  if (!e) return;
  const cats = [...new Set([...knownCategories(), ...DEFAULT_CATEGORIES, ...INCOME_CATEGORIES])];
  openSheet({
    title: id ? 'Edit entry' : 'New entry',
    body: `<form class="form" id="mf">
      <div class="field"><span>Type</span>${segmented('kind', [['expense', 'Expense'], ['income', 'Income']], e.kind)}</div>
      <div class="grid2"><label class="field"><span>Amount (₹)</span><input name="amount" type="number" inputmode="decimal" min="0.01" step="0.01" value="${Number(e.amount) > 0 ? Number(e.amount) : ''}" required autofocus></label>
        <label class="field"><span>Date</span><input type="date" name="date" value="${esc(/^\d{4}-\d{2}-\d{2}$/.test(e.date || '') ? e.date : todayKey())}" max="${todayKey()}"></label></div>
      <label class="field"><span>Category</span><input name="category" list="m-cats" value="${esc(e.category || '')}" placeholder="Pick one or type your own" required><datalist id="m-cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
      <div class="grid2"><label class="field"><span>Note</span><input name="note" value="${esc(e.note || '')}" placeholder="Lunch"></label>
        <label class="field"><span>Paid to / from</span><input name="payee" value="${esc(e.payee || '')}" placeholder="Swiggy"></label></div>
      <div class="row between gap form-actions">${id ? `<button type="button" class="btn ghost sm danger-text" data-del>${I.trash}<span>Delete</span></button>` : '<span></span>'}<button class="btn primary" type="submit">Save</button></div></form>`,
    onMount: (b, api) => {
      bindSeg(b, 'kind', () => {});
      b.querySelector('#mf').addEventListener('submit', async ev => {
        ev.preventDefault(); const f = ev.target; const amount = Math.round(+f.amount.value * 100) / 100;
        if (!(amount > 0)) { f.amount.focus(); return; }
        await save('money', { ...e, id: e.id || uid(), kind: segValue(b, 'kind') || 'expense', amount, date: f.date.value || todayKey(),
          category: canonicalCategory(f.category.value, knownCategories()), note: f.note.value.trim(), payee: f.payee.value.trim() || null, source: e.source || 'manual' });
        api.close(); toast(id ? 'Saved.' : 'Logged.');
      });
      b.querySelector('[data-del]')?.addEventListener('click', async () => { const prev = await remove('money', e.id); api.close(); toast('Deleted.', { undo: () => save('money', prev) }); });
    },
  });
}

function editBudget() {
  const bd = budgets();
  const cats = [...new Set([...DEFAULT_CATEGORIES, ...knownCategories().filter(c => !INCOME_CATEGORIES.includes(c)), ...Object.keys(bd.categories)])];   // every category, his own ones included
  openSheet({
    title: 'Monthly budget',
    body: `<p class="muted">Optional. Only used to show what’s left.</p>
      <form class="form" id="bf"><label class="field"><span>All spending, per month (₹)</span><input name="total" type="number" inputmode="numeric" min="0" step="100" value="${+bd.total || ''}" placeholder="No limit"></label>
      <div class="field"><span>By category (₹ per month)</span><div class="budget-grid">${cats.map(c => `<label class="b-cat"><span>${esc(c)}</span><input type="number" inputmode="numeric" min="0" step="50" data-cat="${esc(c)}" value="${+bd.categories[c] || ''}" placeholder="—" aria-label="${esc(c)} budget"></label>`).join('')}</div></div>
      <div class="row end gap form-actions"><button class="btn primary" type="submit">Save budget</button></div></form>`,
    onMount: (b, api) => b.querySelector('#bf').addEventListener('submit', async ev => {
      ev.preventDefault();
      const categories = {}; b.querySelectorAll('[data-cat]').forEach(i => { if (+i.value > 0) categories[i.dataset.cat] = +i.value; });
      await setMeta('budgets', { total: +ev.target.total.value || 0, categories });
      api.close(); toast('Budget saved.');
    }),
  });
}
