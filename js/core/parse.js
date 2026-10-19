// Natural quick-add: "linkedin 20 min at 6pm", "call mom tomorrow 7:30pm !", "gym fri 6am 45m"
import { dateKey, addDays, toMin, pad, fmtTime, fmtDateKey } from './util.js';

const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function parseQuick(input, { now = new Date(), wake = '07:00', sleep = '23:30', defaultReminder = true } = {}) {
  let s = ` ${input} `;
  const out = { title: '', priority: 2, dueDate: dateKey(now), dueTime: null, durationMin: null, reminder: false, chips: [] };
  const cut = re => { let m = null; s = s.replace(re, (...a) => { m = a; return ' '; }); return m; };

  // priority
  let m = cut(/\s(?:!{1,3}|urgent|important|p1|!high)(?=\s)/i);
  if (m) out.priority = 3;
  else if (cut(/\s(?:p3|!low|someday)(?=\s)/i)) out.priority = 1;

  // reminder keyword
  if (cut(/\s(?:remind(?: me)?|reminder|ping me)(?=\s)/i)) out.reminder = true;

  // duration
  m = cut(/\s(?:for\s)?(\d+(?:\.\d+)?)\s?(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)(?=\s)/i);
  if (m) { const n = parseFloat(m[1]); out.durationMin = Math.round(/^h/i.test(m[2]) ? n * 60 : n); }

  // date
  let dateSet = false;
  if (cut(/\s(?:tomorrow|tmrw|tmr|tom)(?=\s)/i)) { out.dueDate = dateKey(addDays(now, 1)); dateSet = true; }
  else if (cut(/\stoday(?=\s)/i)) dateSet = true;
  else if ((m = cut(/\sin (\d+) days?(?=\s)/i))) { out.dueDate = dateKey(addDays(now, +m[1])); dateSet = true; }
  else if ((m = cut(/\s(?:on\s|next\s)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|urday|sday)?(?=\s)/i))) {
    const target = WD.indexOf(m[1].slice(0, 3).toLowerCase());
    let diff = (target - now.getDay() + 7) % 7; if (diff === 0) diff = 7;
    out.dueDate = dateKey(addDays(now, diff)); dateSet = true;
  }

  // time
  let h = null, mi = 0, ap = null;
  if ((m = cut(/\s(?:at|@|by)\s?(\d{1,2})(?:[:.](\d{2}))?\s?(am|pm|a|p)?(?=\s)/i)) ||
      (m = cut(/\s(\d{1,2})(?:[:.](\d{2}))?\s?(am|pm)(?=\s)/i)) ||
      (m = cut(/\s(\d{1,2}):(\d{2})()(?=\s)/))) {
    h = +m[1]; mi = +(m[2] || 0); ap = (m[3] || '').toLowerCase() || null;
  } else if (cut(/\snoon(?=\s)/i)) { h = 12; ap = 'x'; }
  else if (cut(/\stonight(?=\s)/i)) { h = 21; ap = 'x'; }
  else if (cut(/\s(?:this\s)?morning(?=\s)/i)) { h = 9; ap = 'x'; }
  else if (cut(/\s(?:this\s)?evening(?=\s)/i)) { h = 19; ap = 'x'; }
  if (h !== null && h <= 24 && mi < 60) {
    if (ap === 'pm' || ap === 'p') { if (h < 12) h += 12; }
    else if (ap === 'am' || ap === 'a') { if (h === 12) h = 0; }
    else if (ap === null && h <= 12) h = resolveAmbiguous(h, mi, { now, wake, sleep, isToday: out.dueDate === dateKey(now) });
    out.dueTime = `${pad(h % 24)}:${pad(mi)}`;
    if (!dateSet && (h % 24) * 60 + mi <= now.getHours() * 60 + now.getMinutes()) { out.dueDate = dateKey(addDays(now, 1)); dateSet = true; }
    if (!out.reminder) out.reminder = defaultReminder;
  }

  out.title = s.replace(/\s+/g, ' ').trim() || input.trim();
  if (out.title) out.title = out.title[0].toUpperCase() + out.title.slice(1);

  if (dateSet || out.dueDate !== dateKey(now)) out.chips.push({ k: 'date', label: fmtDateKey(out.dueDate) });
  if (out.dueTime) out.chips.push({ k: 'time', label: fmtTime(out.dueTime) });
  if (out.durationMin) out.chips.push({ k: 'dur', label: out.durationMin >= 60 && out.durationMin % 60 === 0 ? `${out.durationMin / 60} h` : `${out.durationMin} min` });
  if (out.priority === 3) out.chips.push({ k: 'prio', label: 'High priority' });
  if (out.priority === 1) out.chips.push({ k: 'prio', label: 'Low priority' });
  if (out.reminder) out.chips.push({ k: 'rem', label: 'Reminder' });
  return out;
}

// "at 6" -> 6 AM or 6 PM? Pick the reading inside his waking hours, preferring one still ahead today.
function resolveAmbiguous(h, mi, { now, wake, sleep, isToday }) {
  const w = toMin(wake), sl0 = toMin(sleep); const sl = sl0 <= w ? sl0 + 1440 : sl0;
  const cands = [h % 12, (h % 12) + 12];
  const inWindow = c => { const v = c * 60 + mi; return (v >= w && v <= sl) || (v + 1440 >= w && v + 1440 <= sl); };
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const ok = cands.filter(inWindow);
  if (isToday) { const ahead = ok.find(c => c * 60 + mi > nowMin); if (ahead !== undefined) return ahead; }
  if (ok.length) return h === 12 ? 12 : ok[0];
  return h;
}
