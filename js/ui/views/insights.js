// Insights: the week in one look. Four numbers, what Steady has learned, the consistency calendar, when you finish
// things, then goals, money and thoughts. Mirrors android ui/screens/Insights.kt (numbers from core/overview.js).
import { all } from '../../data/store.js';
import { analyze } from '../../data/insights.js';
import { overview, vs, vsMoney } from '../../core/overview.js';
import { fmtINR } from '../../core/money.js';
import { heatmap, bars, WEEK_LABELS } from '../charts.js';
import { fmtHour, esc, DAYS, todayKey, keyAdd, fromKey } from '../../core/util.js';
import { keepRanges } from '../../core/text.js';
import { MOODS } from './thoughts.js';
import { I } from '../icons.js';

const HEAT_WEEKS = 22;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const meter = (frac, key, label, cls = '') => {
  const p = Math.max(0, Math.min(1, frac || 0)) * 100;
  return `<div class="progress meter ${cls}" data-k="${esc(key)}" role="progressbar" aria-label="${esc(label)}" aria-valuenow="${Math.round(p)}" aria-valuemin="0" aria-valuemax="100"><span data-p="${p.toFixed(1)}" style="width:${p.toFixed(1)}%"></span></div>`;
};
const stat = ({ icon, tint, value, label, sub, id }) => `<div class="stat card" data-testid="${id}" style="--tint:var(${tint})">
  <span class="stat-ic">${icon}</span><span class="stat-n" title="${esc(value)}">${esc(value)}</span><span class="stat-l">${esc(label)}</span><span class="stat-sub">${esc(sub || '\u00a0')}</span></div>`;

function activeDays(doneOn) {
  const today = todayKey(), wd = (fromKey(today).getDay() + 6) % 7;
  const start = keyAdd(today, -(HEAT_WEEKS - 1) * 7 - wd);
  let n = 0; for (const [k, c] of doneOn) if (c > 0 && k >= start && k <= today) n++;
  return n;
}

export function renderInsights() {
  const a = analyze();
  window.__lastAnalysis = a;
  const o = overview({ tasks: all('tasks'), goals: all('goals'), money: all('money'), thoughts: all('thoughts') });
  const wdOrder = [1, 2, 3, 4, 5, 6, 0];
  const wd = wdOrder.map(i => a.wdRate[i]);
  const bestIdx = a.bestDay ? wdOrder.indexOf(a.bestDay.i) : -1;
  const hours = a.hourHist;
  const act = activeDays(a.doneOn);

  let html = `<div class="page-head"><div><div class="eyebrow">Insights</div><h1 class="display">Your <em>week</em>.</h1>
    <p class="sub">Tasks, goals, money and thoughts in one look.</p></div></div>

  <div class="stats" data-testid="stats">
    ${stat({ id: 'st-done', icon: I.check, tint: '--accent', value: String(o.doneWeek), label: 'done this week', sub: vs(o.doneWeek - o.doneLastWeek, 'last week') })}
    ${stat({ id: 'st-streak', icon: I.flame, tint: '--hi', value: String(a.streak.current), label: 'day streak', sub: `best ${a.streak.longest}` })}
    ${stat({ id: 'st-goals', icon: I.goals, tint: '--accent', value: o.msTotal ? `${o.msDone}/${o.msTotal}` : '–', label: 'milestones', sub: o.goals.length ? plural(o.goals.length, 'goal') : 'no goals yet' })}
    ${stat({ id: 'st-money', icon: I.money, tint: '--warn', value: fmtINR(Math.round(o.spentWeek)), label: 'spent this week', sub: vsMoney(o.spentWeek - o.spentLastWeek) })}
  </div>

  <section class="card remember" data-testid="remember">
    <h2 class="card-title">${I.spark}<span>What I've learned about you</span></h2>
    <ul class="remember-list">${a.remember.map(r => `<li data-k="${r.k}"><p>${keepRanges(esc(r.text))}</p>${r.detail ? `<small>${esc(r.detail)}</small>` : ''}</li>`).join('')}</ul>
  </section>

  <section class="card chart-card"><div class="card-head"><h2 class="card-title">Consistency</h2><span class="card-aside" data-testid="active-days">${plural(act, 'active day')}</span></div>
    <p class="muted small">Darker days, more finished.</p>
    <div class="chart-wrap" data-testid="heatmap">${heatmap(a.doneOn, { weeks: HEAT_WEEKS })}</div>
    <div class="legend"><span>Less</span>${[0, 1, 2, 3, 4].map(l => `<i class="hm l${l}"></i>`).join('')}<span>More</span></div></section>

  <div class="two-col">
    <section class="card chart-card"><h2 class="card-title">By weekday</h2><p class="muted small">Planned tasks finished, last 8 weeks.</p>
      <div class="chart-wrap" data-testid="weekday">${bars(wd, WEEK_LABELS, { highlight: bestIdx, fmt: v => `${Math.round(v * 100)}%`, label: 'Completion rate by weekday' })}</div></section>
    <section class="card chart-card"><h2 class="card-title">By time of day</h2><p class="muted small">When you finish things.${a.best.start !== null ? ` Peak: ${fmtHour(a.best.start)}–${fmtHour((a.best.start + 2) % 24)}.` : ''}</p>
      <div class="chart-wrap" data-testid="hours">${bars(hours, hours.map((_, h) => (h % 6 === 0 ? fmtHour(h).replace(' ', '') : '')), { highlight: a.best.start ?? -1, fmt: v => `${v} done`, label: 'Tasks finished by hour of day' })}</div>
      <div class="bucket-row">${a.buckets.map(b => `<div><strong>${b.count}</strong><span>${b.label}</span></div>`).join('')}</div></section>
  </div>`;

  if (o.goals.length) {
    html += `<section class="card ins-list" data-testid="ins-goals"><h2 class="card-title">${I.goals}<span>Goals</span></h2>
      ${o.goals.map(g => `<div class="ins-row" data-k="r-ig-${esc(g.id)}">
        <div class="ins-row-top"><span class="ins-name">${esc(g.title)}</span><span class="ins-val">${g.total ? `${g.done}/${g.total}` : 'no milestones'}</span></div>
        ${meter(g.total ? g.done / g.total : 0, `ig-${g.id}`, `${g.title}: milestones done`)}
        ${g.tasksWeek ? `<span class="ins-note">${plural(g.tasksWeek, 'task')} done for it this week</span>` : ''}</div>`).join('')}</section>`;
  }

  if (o.spentMonth > 0) {
    html += `<section class="card ins-list" data-testid="ins-money"><h2 class="card-title">${I.money}<span>Money · this month</span></h2>
      <p class="ins-big">${fmtINR(Math.round(o.spentMonth))} spent</p>
      <p class="muted small">${o.spentLastMonthSameDay > 0 ? esc(vsMoney(o.spentMonth - o.spentLastMonthSameDay, 'last month by today')) : 'First month logged.'}</p>
      ${o.cats.map(([c, v]) => `<div class="ins-row" data-k="r-im-${esc(c)}">
        <div class="ins-row-top"><span class="ins-name">${esc(c)}</span><span class="ins-val">${fmtINR(Math.round(v))}</span></div>
        ${meter(v / o.spentMonth, `im-${c}`, `${c}: share of spending`, 'warn')}</div>`).join('')}</section>`;
  }

  if (o.thoughtsMonth > 0) {
    const m = o.moodAvg == null ? null : Math.min(5, Math.max(1, Math.round(o.moodAvg)));
    html += `<section class="card ins-list" data-testid="ins-thoughts"><h2 class="card-title">${I.thoughts}<span>Thoughts · last 30 days</span></h2>
      <p class="ins-big">${plural(o.thoughtsMonth, 'thought')} saved</p>
      ${o.topTags.length ? `<div class="ins-tags">${o.topTags.map(([t, n]) => `<span class="pill tag-pill">#${esc(t)} <b>${n}</b></span>`).join('')}</div>` : ''}
      ${m ? `<div class="ins-mood"><span class="muted small">Mood</span>${meter((o.moodAvg - 1) / 4, 'it-mood', `Average mood: ${MOODS[m]}`, `mood-meter m${m}`)}<span class="ins-val">${MOODS[m]}</span></div>` : ''}
    </section>`;
  }
  return html;
}

export function insightsForExport() {
  const a = analyze();
  return { remember: a.remember.map(r => r.text), streak: a.streak, last7: a.last7, last30: a.last30, bestWindowStart: a.best.start, bestDay: a.bestDay ? DAYS[a.bestDay.i] : null, avgDonePerDay: a.avgDone, slump: a.slump };
}
