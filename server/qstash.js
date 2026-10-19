// Precise reminder trigger (optional): for every reminder the server queues, ask Upstash QStash to call
// POST /api/cron/reminders at exactly that minute. GitHub Actions' 5-minute cron stays on as the backstop.
// Free tier: 1,000 messages/day. Auth: QStash forwards our CRON_SECRET as the Authorization header, which
// /api/cron/reminders already accepts, so there is no extra signature scheme to maintain.
// Env: QSTASH_TOKEN (required), QSTASH_URL (default https://qstash.upstash.io), PUBLIC_URL (e.g. https://karthikytodo.vercel.app),
//      CRON_SECRET (≥16 chars, shared with the cron endpoint).
const env = k => process.env[k] || '';
export const qstashReady = () => !!(env('QSTASH_TOKEN') && env('PUBLIC_URL') && env('CRON_SECRET').length >= 16);

// One message per distinct fire minute: several reminders due at 18:00 share a single wake-up (dedup id).
export async function scheduleExact(fireAts, { now = Date.now() } = {}) {
  if (!qstashReady()) return { scheduled: 0, skipped: 'not configured' };
  const minutes = [...new Set(fireAts.filter(t => Number.isFinite(t) && t > now + 5_000 && t < now + 7 * 864e5).map(t => Math.floor(t / 60e3)))];
  const base = (env('QSTASH_URL') || 'https://qstash.upstash.io').replace(/\/+$/, '');
  const dest = `${env('PUBLIC_URL').replace(/\/+$/, '')}/api/cron/reminders`;
  let scheduled = 0; const errors = [];
  for (const m of minutes.slice(0, 50)) {
    try {
      const res = await fetch(`${base}/v2/publish/${dest}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env('QSTASH_TOKEN')}`, 'Content-Type': 'application/json', 'Upstash-Not-Before': String(m * 60),
          'Upstash-Deduplication-Id': `steady-${m}`, 'Upstash-Retries': '2', 'Upstash-Forward-Authorization': `Bearer ${env('CRON_SECRET')}` },
        body: '{}', signal: AbortSignal.timeout(5000) });
      if (res.ok) scheduled++; else errors.push(res.status);
    } catch (e) { errors.push(e.name); }
  }
  return { scheduled, errors };
}
