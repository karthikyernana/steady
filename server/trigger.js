// What wakes the reminder sender at the right moment. Three layers, best first; all of them call the same idempotent sendDue().
//  1. QStash (if configured): one delayed HTTP call per distinct fire minute. Exact, survives anything, wakes the database only then.
//  2. Near-term timer: a reminder due within the next few minutes is sent by this very function invocation, kept alive with
//     Vercel's waitUntil (no extra service). Covers "remind me in 5 minutes" without QStash.
//  3. Backstops: GitHub Actions cron and any app open / sync (devices also fire their own reminders while alive).
// Due-now reminders (snoozes, edits to a time that already passed) are sent immediately.
import { qstashReady, scheduleExact } from './qstash.js';
import { sendDue } from './push.js';

const NEAR_MS = () => +(process.env.REMINDER_NEAR_MS || 270_000);   // must stay below the function's maxDuration (300 s)
const ctx = () => globalThis[Symbol.for('@vercel/request-context')]?.get?.() || null;
export const waitUntil = p => { const c = ctx(); if (c?.waitUntil) c.waitUntil(p); return p; };
export const triggerMode = () => (qstashReady() ? 'exact' : 'near-term+cron');
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function triggerFor(fireAts, { now = Date.now() } = {}) {
  const ats = fireAts.filter(Number.isFinite);
  if (!ats.length) return { mode: triggerMode(), exact: null };
  const dueNow = ats.some(t => t <= now + 2_000 && t > now - 30 * 60e3);
  if (dueNow) await sendDue().catch(e => console.warn('[trigger] due-now send', e.message));
  if (qstashReady()) {
    const r = await scheduleExact(ats, { now }).catch(() => ({ scheduled: 0 }));
    return { mode: 'exact', exact: r.scheduled };
  }
  // Without QStash: hold this invocation open until the soonest near-term reminder, then send.
  const near = ats.filter(t => t > now + 2_000 && t - now < NEAR_MS()).sort((a, b) => a - b);
  if (near.length && ctx()?.waitUntil) {
    waitUntil((async () => {
      for (const t of [...new Set(near.map(x => Math.floor(x / 1000)))]) {
        await sleep(Math.max(0, t * 1000 - Date.now() + 300));
        await sendDue().catch(e => console.warn('[trigger] near-term send', e.message));
      }
    })());
    return { mode: 'near-term', exact: near.length };
  }
  return { mode: 'cron', exact: 0 };
}
