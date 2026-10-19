// Sends due reminders as Web Push. Called by POST /api/cron/reminders (GitHub Actions every 5 minutes).
import webpush from 'web-push';
import { query, withOwner } from './db.js';

const EARLY_MS = 150_000;   // cron runs every ~5 min: send up to 2.5 min early rather than up to 5 min late
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
  const report = { due: 0, sent: 0, failed: 0, pruned: 0 };
  for (const o of owners) {
    await withOwner(o.id, async c => {
      const { rows: due } = await c.query(
        `select key, fire_at, title, body, url, tag from scheduled_notifications
          where owner_id = app_owner() and sent_at is null and fire_at <= $1 and fire_at >= $2 order by fire_at limit 200 for update skip locked`,
        [new Date(now.getTime() + EARLY_MS), new Date(now.getTime() - LATE_MS)]);
      if (!due.length) return;
      const { rows: subs } = await c.query('select id, endpoint, p256dh, auth from push_subscriptions where owner_id = app_owner()');
      for (const n of due) {
        report.due++;
        const payload = JSON.stringify({ title: n.title, body: n.body, url: n.url || '/#/today', tag: n.tag || n.key });
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
