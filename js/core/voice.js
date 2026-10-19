// Steady's voice: one calm, specific line that reacts to Karthik's state right now.
// Pure function so every platform can reuse it. Order matters: the first rule that fits wins.
import { fmtHour, toMin, keyAdd } from './util.js';

export function todayLine({ now = new Date(), total = 0, done = 0, open = 0, a = null, profile = {}, checkins = [], mvd = false }) {
  const h = now.getHours(), m = h * 60 + now.getMinutes();
  let sleep = toMin(profile.sleep || '23:30'); if (sleep < 360) sleep += 1440;
  const mNow = m < 360 ? m + 1440 : m;
  const best = a?.best?.start ?? null;
  const yKey = a ? keyAdd(a.today, -1) : null;
  const yEnergy = checkins.find(c => c.date === yKey)?.energy;

  if (total && !open) return done ? `All ${done} done. Rest is part of the plan.` : 'Everything decided. Rest is part of the plan.';
  if (mNow >= sleep - 45 && open) return "It's late. Whatever's left can wait for tomorrow; sleep is the better investment.";
  if (mvd) return 'A small day on purpose. Three little things is a full win.';
  if (a?.slump?.reason === 'away') return 'Welcome back. No catching up needed; start with one small thing.';
  if (yEnergy && yEnergy <= 2) return 'Your energy was low yesterday. Go gentle and pick the easy wins first.';
  if (!total) return h < 12 ? 'Pick the one thing that would make today count.' : 'Nothing planned yet. One small thing is enough to start.';
  if (best !== null) {
    if (h >= best && h < best + 2) return `You're in your best hours now. Good time for the hard one.`;
    if (h < best && best - h <= 3) return `Your best hours start at ${fmtHour(best)}. Save the hardest task for then.`;
  }
  if (a?.streak?.current >= 3) return `Day ${a.streak.current + (done ? 0 : 1)} of your run. Keep it small and keep it going.`;
  if (done && open) return `${done} down, ${open} to go. Steady pace.`;
  return h < 12 ? `${open} on the list. Start with the smallest; momentum does the rest.` : `${open} still open. Pick one and finish it.`;
}
