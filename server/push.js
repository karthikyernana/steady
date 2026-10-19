// Sends due reminders as Web Push. Called by POST /api/cron/reminders (GitHub Actions every 5 minutes).
import webpush from 'web-push';
import { query, withOwner } from './db.js';

// How early a reminder may go out. With only the 5-minute GitHub cron, sending up to 2.5 min early beats up to 5 min late.
// With a precise trigger (QStash per reminder, or a 1-minute cron) keep it small. Override with REMINDER_EARLY_MS.
const EARLY_MS_DEFAULT = () => (process.env.QSTASH_TOKEN ? 20_000 : 150_000);
const earlyMs = () => (Number.isFinite(+process.env.REMINDER_EARLY_MS) && process.env.REMINDER_EARLY_MS !== '' ? +process.env.REMINDER_EARLY_MS : EARLY_MS_DEFAULT());
const LATE_MS = 30 * 60e3;  // never send something more than 30 min stale

export function vapidReady() {
  const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: sub } = process.env;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(sub || 'mailto:karthikyernana@gmail.com', pub, priv);
  return true;
}

export async function sendDue(now = new Date()) {
  if (!vapidReady()) throw Object.assign(new Error('VAPID keys are not configured'), { status: 501 });
  const { rows: owners } = await query('select id from owners');
  const report = { due: 0, sent: 0, failed: 0, pruned: 0, nextAt: null };
  for (const o of owners) {
    await withOwner(o.id, async c => {
      const { rows: due } = await c.query(
        `select key, fire_at, title, body, url, tag from scheduled_notifications
          where owner_id = app_owner() and sent_at is null and fire_at <= $1 and fire_at >= $2 order by fire_at limit 200 for update skip locked`,
        [new Date(now.getTime() + earlyMs()), new Date(now.getTime() - LATE_MS)]);
      await c.query(`delete from scheduled_notifications where owner_id = app_owner() and fire_at < now() - interval '2 days'`);
      const nx = (await c.query(`select min(extract(epoch from fire_at) * 1000) as t from scheduled_notifications where owner_id = app_owner() and sent_at is null and fire_at > $1`, [new Date(now.getTime() + earlyMs())])).rows[0].t;
      if (nx && (!report.nextAt || +nx < report.nextAt)) report.nextAt = Number(nx);
      if (!due.length) return;
      const { rows: subs } = await c.query('select id, endpoint, p256dh, auth from push_subscriptions where owner_id = app_owner()');
      for (const n of due) {
        report.due++;
        const payload = JSON.stringify({ title: n.title, body: n.body, url: n.url || '/#/today', tag: n.tag || n.key, key: n.key, at: new Date(n.fire_at).getTime() });
        for (const s of subs) {
          try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 900, urgency: 'high', timeout: 8000 });
            report.sent++;
            await c.query('update push_subscriptions set last_ok_at = now(), last_error = null where id = $1', [s.id]);
          } catch (e) {
            if (e.statusCode === 404 || e.statusCode === 410) { report.pruned++; await c.query('delete from push_subscriptions where id = $1', [s.id]); }
            else { report.failed++; await c.query('update push_subscriptions set last_error = $2 where id = $1', [s.id, String(e.statusCode || e.message).slice(0, 200)]); }
          }
        }
        await c.query('update scheduled_notifications set sent_at = now() where owner_id = app_owner() and key = $1 and fire_at = $2', [n.key, n.fire_at]);
      }
    });
  }
  return report;
}
