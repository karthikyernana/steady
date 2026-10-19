-- Web Push subscriptions (one per device) and the reminder queue that /api/cron/reminders drains.

create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references owners (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  device      text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  last_error  text
);
alter table push_subscriptions enable row level security;
alter table push_subscriptions force row level security;
drop policy if exists push_owner on push_subscriptions;
create policy push_owner on push_subscriptions using (owner_id = app_owner()) with check (owner_id = app_owner());

-- key is stable per reminder (st-<taskId>, st-checkin-YYYYMMDD) so all devices converge on one row
create table if not exists scheduled_notifications (
  owner_id   uuid not null references owners (id) on delete cascade,
  key        text not null check (length(key) between 1 and 160),
  fire_at    timestamptz not null,
  title      text not null check (length(title) <= 200),
  body       text not null default '' check (length(body) <= 500),
  url        text,
  tag        text,
  sent_at    timestamptz,
  updated_at timestamptz not null default now(),
  primary key (owner_id, key)
);
create index if not exists sched_due on scheduled_notifications (fire_at) where sent_at is null;
alter table scheduled_notifications enable row level security;
alter table scheduled_notifications force row level security;
drop policy if exists sched_owner on scheduled_notifications;
create policy sched_owner on scheduled_notifications using (owner_id = app_owner()) with check (owner_id = app_owner());

create or replace function sched_reset() returns trigger language plpgsql as $$
begin
  if new.fire_at is distinct from old.fire_at then new.sent_at := null; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists sched_reset on scheduled_notifications;
create trigger sched_reset before update on scheduled_notifications for each row execute function sched_reset();
