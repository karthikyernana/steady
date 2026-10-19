-- v1.3: Money tab + voice agent.
-- 1. `money` joins the synced collections (records stay one row per record, LWW, RLS per owner).
-- 2. agent_memory: the small per-user profile the agent learns from accepted drafts (categories, payees, wording fixes).
-- 3. agent_usage: per-user daily call counter so a leaked session cannot run up the STT/LLM bill.

alter table records drop constraint if exists records_coll_check;
alter table records add constraint records_coll_check check (coll in ('tasks', 'goals', 'thoughts', 'checkins', 'meta', 'money'));

create table if not exists agent_memory (
  owner_id   uuid primary key references owners (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table agent_memory enable row level security;
alter table agent_memory force row level security;
drop policy if exists agent_memory_owner on agent_memory;
create policy agent_memory_owner on agent_memory using (owner_id = app_owner()) with check (owner_id = app_owner());

create table if not exists agent_usage (
  owner_id uuid not null references owners (id) on delete cascade,
  day      date not null,
  kind     text not null check (kind in ('stt', 'plan')),
  n        integer not null default 0,
  primary key (owner_id, day, kind)
);
alter table agent_usage enable row level security;
alter table agent_usage force row level security;
drop policy if exists agent_usage_owner on agent_usage;
create policy agent_usage_owner on agent_usage using (owner_id = app_owner()) with check (owner_id = app_owner());
