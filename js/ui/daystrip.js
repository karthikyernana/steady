// Today at a glance: the next timed thing with a live countdown, then the waking day as a line with every timed task as a
// dot (filled = done, ring = to do, high priority ring in the warm colour) and a "now" marker. Reads in one second.
// Mirrors android ui/screens/DayStrip.kt.
import { esc, fmtTime, fromMin, toMin } from '../core/util.js';

/** "in 35 min", "now", "2 h 10 min ago" relative to the current minute. */
export function untilLabel(target, now) {
  const d = target - now;
  const span = m => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);
  return d >= -4 && d <= 4 ? 'now' : d > 0 ? `in ${span(d)}` : `${span(-d)} ago`;
}

export const nowMin = (d = new Date()) => d.getHours() * 60 + d.getMinutes();

export function renderDayStrip(todays, { wake = '07:00', sleep = '23:30', now = nowMin() } = {}) {
  const timed = todays.filter(t => t.dueTime).sort((a, b) => toMin(a.dueTime) - toMin(b.dueTime));
  if (!timed.length) return '';
  const next = timed.find(t => t.status === 'open' && toMin(t.dueTime) >= now - 15) || null;
  const first = toMin(timed[0].dueTime), last = toMin(timed[timed.length - 1].dueTime);
  const w0 = Math.max(0, Math.min(toMin(wake) ?? 420, first - 30));
  let w1 = toMin(sleep) ?? 1410; if (w1 <= w0) w1 += 1440;
  w1 = Math.max(w1, last + 30);
  const pos = m => `${(Math.min(1, Math.max(0, (m - w0) / (w1 - w0))) * 100).toFixed(2)}%`;
  const nowIn = now >= w0 && now <= w1;
  const allDone = timed.every(t => t.status !== 'open');

  const head = next
    ? `<div class="ds-head"><div class="ds-next"><div class="eyebrow ds-eyebrow">Next up · ${untilLabel(toMin(next.dueTime), now)}</div><h2 class="ds-title">${esc(next.title)}</h2></div><span class="ds-time">${fmtTime(next.dueTime)}</span></div>`
    : `<div class="ds-head"><div class="ds-next"><div class="eyebrow">Timed tasks</div><h2 class="ds-title">${allDone ? 'All timed tasks done.' : 'Nothing else timed today.'}</h2></div></div>`;
  const dots = timed.map(t => {
    const done = t.status === 'done', cls = done ? 'done' : t.status === 'skipped' ? 'skipped' : t.priority === 3 ? 'todo hi' : 'todo';
    return `<i class="ds-dot ${cls}${t === next ? ' next' : ''}" style="left:${pos(toMin(t.dueTime))}" title="${esc(t.title)} · ${fmtTime(t.dueTime)}${done ? ' · done' : ''}"></i>`;
  }).join('');
  const label = `${timed.length} timed task${timed.length === 1 ? '' : 's'} today, ${timed.filter(t => t.status === 'done').length} done` + (next ? `. Next: ${next.title} at ${fmtTime(next.dueTime)}` : '');
  return `<section class="card daystrip" id="daystrip" data-testid="daystrip">${head}
    <div class="ds-line" role="img" aria-label="${esc(label)}">
      <span class="ds-track"></span>${nowIn ? `<span class="ds-past" style="width:${pos(now)}"></span>` : ''}${dots}${nowIn ? `<span class="ds-now" style="left:${pos(now)}" title="Now"></span>` : ''}
    </div>
    <div class="ds-foot"><span>${fmtTime(fromMin(w0))}</span><span class="ds-legend"><span><i class="ds-key done"></i>done</span><span><i class="ds-key todo"></i>to do</span></span><span>${fmtTime(fromMin(w1))}</span></div>
  </section>`;
}
