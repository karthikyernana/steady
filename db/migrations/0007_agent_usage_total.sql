-- v1.3: an all-users daily ceiling for the paid AI calls. Sign-ups are open, so the per-user cap in agent_usage alone
-- does not bound the bill (many accounts x 200 calls). This table holds counters only (no owner, no user data), so it
-- has no row-level security; the API touches it only through countUse() in server/agent.js. Idempotent.
create table if not exists agent_usage_total (
  day  date not null,
  kind text not null check (kind in ('stt', 'plan')),
  n    integer not null default 0,
  primary key (day, kind)
);
