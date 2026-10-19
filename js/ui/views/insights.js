import { all } from '../../data/store.js';
import { analyze } from '../../data/insights.js';
import { heatmap, bars, scatter, WEEK_LABELS } from '../charts.js';
import { fmtDateKey, fmtHour, esc, DAYS } from '../../core/util.js';
import { goalProgress } from './goals.js';
import { I } from '../icons.js';

const pct = x => (x == null ? '—' : `${Math.round(x * 100)}%`);

export function renderInsights() {
  const a = analyze();
  window.__lastAnalysis = a;
  const wdOrder = [1, 2, 3, 4, 5, 6, 0];
  const wd = wdOrder.map(i => a.wdRate[i]);
  const bestIdx = a.bestDay ? wdOrder.indexOf(a.bestDay.i) : -1;
  const hours = a.hourHist;
  const wins = all('checkins').filter(c => c.win).sort((x, y) => y.date.localeCompare(x.date)).slice(0, 5);
  const goals = all('goals');

  return `<div class="page-head"><div><div class="eyebrow">Insights</div><h1 class="display">Your <em>patterns</em>.</h1>
    <p class="sub">Learned on this device from what you actually do. Nothing leaves unless you sync it.</p></div></div>

  <section class="card remember" data-testid="remember">
    <div class="row between"><h2 class="card-title">${I.spark}<span>What I've learned about you</span></h2></div>
    <ul class="remember-list">${a.remember.map(r => `<li data-k="${r.k}"><p>${esc(r.text)}</p>${r.detail ? `<small>${esc(r.detail)}</small>` : ''}</li>`).join('')}</ul>
  </section>

  <div class="stats">
    <div class="stat card"><span class="stat-n serif" data-testid="streak-current">${a.streak.current}</span><span class="stat-l">day streak</span></div>
    <div class="stat card"><span class="stat-n serif">${a.streak.longest}</span><span class="stat-l">best streak</span></div>
    <div class="stat card"><span class="stat-n serif">${pct(a.last30)}</span><span class="stat-l">done, 30 days</span></div>
    <div class="stat card"><span class="stat-n serif">${a.checkinCount14}<small>/14</small></span><span class="stat-l">check-ins</span></div>
  </div>

  <section class="card chart-card"><h2 class="card-title">Consistency</h2><p class="muted small">Each square is a day. Darker means more finished.</p>
    <div class="chart-wrap" data-testid="heatmap">${heatmap(a.doneOn)}</div>
    <div class="legend"><span>Less</span>${[0, 1, 2, 3, 4].map(l => `<i class="hm l${l}"></i>`).join('')}<span>More</span></div></section>

  <div class="two-col">
    <section class="card chart-card"><h2 class="card-title">By weekday</h2><p class="muted small">Share of planned tasks finished, last 8 weeks.</p>
      <div class="chart-wrap" data-testid="weekday">${bars(wd, WEEK_LABELS, { highlight: bestIdx, fmt: v => `${Math.round(v * 100)}%`, label: 'Completion rate by weekday' })}</div></section>
    <section class="card chart-card"><h2 class="card-title">By time of day</h2><p class="muted small">When you actually tick things off.${a.best.start !== null ? ` Peak: ${fmtHour(a.best.start)}–${fmtHour((a.best.start + 2) % 24)}.` : ''}</p>
      <div class="chart-wrap" data-testid="hours">${bars(hours, hours.map((_, h) => (h % 6 === 0 ? fmtHour(h).replace(' ', '') : '')), { highlight: a.best.start ?? -1, fmt: v => `${v} done`, label: 'Tasks finished by hour of day' })}</div>
      <div class="bucket-row">${a.buckets.map(b => `<div><strong>${b.count}</strong><span>${b.label}</span></div>`).join('')}</div></section>
  </div>

  <div class="two-col">
    <section class="card chart-card"><h2 class="card-title">Energy vs output</h2><p class="muted small">Evening energy (1–5) against tasks finished that day.</p>
      ${a.energyVsOutput.length >= 3 ? `<div class="chart-wrap" data-testid="scatter">${scatter(a.energyVsOutput, a.byEnergy)}</div>` : '<p class="empty-inline">A few evening check-ins and this fills in.</p>'}</section>
    <section class="card"><h2 class="card-title">Recent wins</h2>
      ${wins.length ? `<ul class="wins">${wins.map(w => `<li><span class="muted small">${fmtDateKey(w.date)}</span><p>${esc(w.win)}</p></li>`).join('')}</ul>` : '<p class="empty-inline">Your evening check-ins collect your wins here. They add up.</p>'}</section>
  </div>

  ${goals.length ? `<section class="card"><h2 class="card-title">Goals</h2>${goals.map(g => `<div class="goal-mini" data-k="gm-${g.id}"><div class="row between"><span>${esc(g.title)}</span><span class="muted small">${pct(goalProgress(g))}</span></div><div class="progress thin" role="progressbar" aria-label="${esc(g.title)} progress" aria-valuenow="${Math.round(goalProgress(g) * 100)}" aria-valuemin="0" aria-valuemax="100"><span data-p="${(goalProgress(g) * 100).toFixed(1)}" style="width:${(goalProgress(g) * 100).toFixed(1)}%"></span></div></div>`).join('')}</section>` : ''}`;
}

export function insightsForExport() {
  const a = analyze();
  return { remember: a.remember.map(r => r.text), streak: a.streak, last7: a.last7, last30: a.last30, bestWindowStart: a.best.start, bestDay: a.bestDay ? DAYS[a.bestDay.i] : null, avgDonePerDay: a.avgDone, slump: a.slump };
}
