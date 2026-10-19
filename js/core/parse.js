// Natural quick-add. Understands how people actually type a to-do:
//   "remind me to call mom tomorrow evening"   "gym fri 6am 45m"   "dsa 2 problems at 9 !"
//   "pay rent on 1st"   "submit report 25 oct 5pm"   "deep work 1h30 this afternoon"   "read next week"
// Returns the clean title plus date, time, duration, priority, reminder, a goal guess, and chips explaining each part.
import { dateKey, addDays, toMin, pad, fmtTime, fmtDateKey } from './util.js';

const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const STOP = new Set('a an the to for of and or with on in at my me i be do get go make take have has is are this that it up out some more'.split(' '));
const FILLER = /^\s*(?:(?:please\s+)?remind me (?:to|about)|reminder(?: to)?:?|don'?t forget (?:to)?|do not forget (?:to)?|i (?:need|have|want|got) to|need to|have to|gotta|i should|should|todo:?|to-do:?|task:?)\s+/i;
const DAYPART = { morning: 9, 'this morning': 9, afternoon: 15, 'this afternoon': 15, evening: 19, 'this evening': 19, tonight: 21, 'at night': 21, noon: 12, midnight: 0, 'after lunch': 14, 'before lunch': 12, eod: 18, 'end of day': 18, 'at lunch': 13 };

export function parseQuick(input, { now = new Date(), wake = '07:00', sleep = '23:30', defaultReminder = true, goals = [] } = {}) {
  let s = ` ${String(input).replace(FILLER, ' ')} `;
  const out = { title: '', priority: 2, dueDate: dateKey(now), dueTime: null, durationMin: null, reminder: false, goalId: null, chips: [] };
  const cut = re => { let m = null; s = s.replace(re, (...a) => { m = a; return ' '; }); return m; };
  if (/^\s*(?:please\s+)?remind me/i.test(input)) out.reminder = true;

  // priority
  if (cut(/\s(?:!{1,3}|urgent|important|asap|p1|!high|high priority)(?=\s)/i)) out.priority = 3;
  else if (cut(/\s(?:p3|!low|low priority|someday|maybe)(?=\s)/i)) out.priority = 1;

  // reminder keyword anywhere
  if (cut(/\s(?:remind(?: me)?|reminder|ping me|notify me|alert me)(?=\s)/i)) out.reminder = true;

  // relative time: "in 2 hours", "in 30 min" (a start time, not a duration)
  let rel = cut(/\sin (\d+|an?|one|two|half an?) (hours?|hrs?|h|minutes?|mins?|m)(?=\s)/i);
  if (rel) {
    const n = /^half/i.test(rel[1]) ? 0.5 : { a: 1, an: 1, one: 1, two: 2 }[rel[1].toLowerCase()] || +rel[1];
    rel = Math.round(/^h/i.test(rel[2]) ? n * 60 : n);
  }

  // duration: "45m", "2h", "1h30", "1.5 hours", "for 20 minutes", "half an hour", "an hour"
  let m = cut(/\s(?:for\s)?(\d+)\s?h(?:rs?|ours?)?\s?(\d{1,2})\s?m?(?:in(?:ute)?s?)?(?=\s)/i);
  if (m) out.durationMin = +m[1] * 60 + +m[2];
  else if ((m = cut(/\s(?:for\s)?(\d+(?:\.\d+)?)\s?(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)(?=\s)/i))) { const n = parseFloat(m[1]); out.durationMin = Math.round(/^h/i.test(m[2]) ? n * 60 : n); }
  else if (cut(/\s(?:for\s)?half an? hour(?=\s)/i)) out.durationMin = 30;
  else if (cut(/\s(?:for\s)?(?:an|one) hour(?=\s)/i)) out.durationMin = 60;

  // date
  let dateSet = false;
  const setDate = d => { out.dueDate = dateKey(d); dateSet = true; };
  const nextWd = target => { let diff = (target - now.getDay() + 7) % 7; if (diff === 0) diff = 7; return addDays(now, diff); };
  if (cut(/\s(?:day after tomorrow|overmorrow)(?=\s)/i)) setDate(addDays(now, 2));
  else if (cut(/\s(?:tomorrow|tmrw|tmr|tom)(?=\s)/i)) setDate(addDays(now, 1));
  else if (cut(/\stoday(?=\s)/i)) dateSet = true;
  else if ((m = cut(/\sin (\d+|a|one|two|three) (day|days|week|weeks)(?=\s)/i))) {
    const n = { a: 1, one: 1, two: 2, three: 3 }[m[1].toLowerCase()] || +m[1];
    setDate(addDays(now, /^w/i.test(m[2]) ? n * 7 : n));
  } else if (cut(/\snext week(?=\s)/i)) setDate(nextWd(1));
  else if (cut(/\s(?:this |the )?weekend(?=\s)/i)) setDate(now.getDay() === 6 || now.getDay() === 0 ? now : nextWd(6));
  else if ((m = cut(/\s(?:on\s)?(\d{4})-(\d{1,2})-(\d{1,2})(?=\s)/))) setDate(new Date(+m[1], +m[2] - 1, +m[3]));
  else if ((m = cut(/\s(?:on\s)?(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?(?=\s)/))) setDate(future(+m[1], +m[2] - 1, m[3]));   // dd/mm (India)
  else if ((m = cut(/\s(?:on\s)?(\d{1,2})(?:st|nd|rd|th)?\s(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?:\s(\d{4}))?(?=\s)/i))) setDate(future(+m[1], MON.indexOf(m[2].slice(0, 3).toLowerCase()), m[3]));
  else if ((m = cut(/\s(?:on\s)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s(\d{1,2})(?:st|nd|rd|th)?(?:,?\s(\d{4}))?(?=\s)/i))) setDate(future(+m[2], MON.indexOf(m[1].slice(0, 3).toLowerCase()), m[3]));
  else if ((m = cut(/\s(?:on\s)?(?:the\s)?(\d{1,2})(st|nd|rd|th)(?=\s)/i))) {
    const d = +m[1]; let dt = new Date(now.getFullYear(), now.getMonth(), d);
    if (dateKey(dt) < dateKey(now)) dt = new Date(now.getFullYear(), now.getMonth() + 1, d);
    setDate(dt);
  } else if ((m = cut(/\s(?:on\s|this\s|(next)\s)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|urday|sday)?(?=\s)/i))) {
    const target = WD.indexOf(m[2].slice(0, 3).toLowerCase());
    let diff = (target - now.getDay() + 7) % 7; if (diff === 0) diff = 7;
    setDate(addDays(now, diff));
  }
  function future(d, mo, y) {
    let yr = y ? (+y < 100 ? 2000 + +y : +y) : now.getFullYear();
    let dt = new Date(yr, mo, d);
    if (!y && dateKey(dt) < dateKey(now)) dt = new Date(yr + 1, mo, d);
    return dt;
  }

  // time
  let h = null, mi = 0, ap = null;
  if (rel) {
    const t = new Date(now.getTime() + rel * 60000);
    out.dueTime = `${pad(t.getHours())}:${pad(t.getMinutes())}`; out.dueDate = dateKey(t); dateSet = true;
    if (!out.reminder) out.reminder = defaultReminder;
  } else
  if ((m = cut(/\s(?:at|@|by|around|~)\s?(\d{1,2})(?:[:.](\d{2}))?\s?(am|pm|a|p)?(?=\s)/i)) ||
      (m = cut(/\s(\d{1,2})(?:[:.](\d{2}))?\s?(am|pm)(?=\s)/i)) ||
      (m = cut(/\s(\d{1,2}):(\d{2})()(?=\s)/))) {
    h = +m[1]; mi = +(m[2] || 0); ap = (m[3] || '').toLowerCase() || null;
  } else {
    for (const [k, v] of Object.entries(DAYPART).sort((a, b) => b[0].length - a[0].length)) {
      const re = new RegExp(`\\s(?:in the |at |by )?${k}(?=\\s)`, 'i');
      const at = s.search(re);
      if (at > 0 && s.slice(0, at).trim()) { cut(re); h = v; ap = 'x'; break; }   // a leading "morning run" stays in the title
    }
  }
  if (h !== null && h <= 24 && mi < 60) {
    if (ap === 'pm' || ap === 'p') { if (h < 12) h += 12; }
    else if (ap === 'am' || ap === 'a') { if (h === 12) h = 0; }
    else if (ap === null && h <= 12) h = resolveAmbiguous(h, mi, { now, wake, sleep, isToday: out.dueDate === dateKey(now) });
    out.dueTime = `${pad(h % 24)}:${pad(mi)}`;
    if (!dateSet && (h % 24) * 60 + mi <= now.getHours() * 60 + now.getMinutes()) { out.dueDate = dateKey(addDays(now, 1)); dateSet = true; }
    if (!out.reminder) out.reminder = defaultReminder;
  }

  out.title = s.replace(/\s+/g, ' ').replace(/^\s*(?:to|and|of)\s+/i, '').replace(/\s+(?:on|at|by|for)\s*$/i, '').trim() || String(input).trim();
  if (out.title) out.title = out.title[0].toUpperCase() + out.title.slice(1);

  // goal guess: the goal whose title or daily actions share the most meaningful words with the task
  const words = t => new Set(String(t).toLowerCase().match(/[a-z0-9]+/g)?.filter(w => w.length > 2 && !STOP.has(w)) || []);
  const tw = words(out.title); let best = null, bestScore = 0;
  for (const g of goals) {
    const gw = words([g.title, ...(g.actions || []).map(a => a.title), ...(g.milestones || []).map(x => x.title)].join(' '));
    let score = 0; for (const w of tw) if (gw.has(w) || (w.length > 4 && [...gw].some(x => x.length > 4 && (x.startsWith(w) || w.startsWith(x))))) score++;
    if (score > bestScore) { bestScore = score; best = g; }
  }
  if (best && bestScore >= 1) out.goalId = best.id;

  if (dateSet || out.dueDate !== dateKey(now)) out.chips.push({ k: 'date', label: fmtDateKey(out.dueDate) });
  if (out.dueTime) out.chips.push({ k: 'time', label: fmtTime(out.dueTime) });
  if (out.durationMin) out.chips.push({ k: 'dur', label: out.durationMin >= 60 && out.durationMin % 60 === 0 ? `${out.durationMin / 60} h` : out.durationMin > 60 ? `${Math.floor(out.durationMin / 60)} h ${out.durationMin % 60} min` : `${out.durationMin} min` });
  if (out.priority === 3) out.chips.push({ k: 'prio', label: 'High priority' });
  if (out.priority === 1) out.chips.push({ k: 'prio', label: 'Low priority' });
  if (out.reminder) out.chips.push({ k: 'rem', label: 'Reminder' });
  if (out.goalId) out.chips.push({ k: 'goal', label: `→ ${best.title}` });
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
