-- Steady database (Neon Postgres). Accessed ONLY by the Vercel API (server/), never by browsers.
-- Single user: the owners table only accepts allow-listed emails.
-- Defense in depth: every owner-scoped table has FORCE ROW LEVEL SECURITY keyed on the per-transaction
-- setting app.owner_id, which the API sets via withOwner() before touching user data.

create extension if not exists pgcrypto;

create table if not exists allowed_emails (email text primary key);
insert into allowed_emails (email) values ('karthikyernana@gmail.com') on conflict do nothing;

create table if not exists owners (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  created_at timestamptz not null default now()
);

create or replace function enforce_allowlist() returns trigger language plpgsql as $$
begin
  if new.email is null or not exists (select 1 from allowed_emails a where lower(a.email) = lower(new.email)) then
    raise exception 'Steady is private: % is not allowed', coalesce(new.email, 'null') using errcode = '42501';
  end if;
  new.email := lower(new.email);
  return new;
end $$;
drop trigger if exists owners_allowlist on owners;
create trigger owners_allowlist before insert or update of email on owners for each row execute function enforce_allowlist();

-- sessions: only the SHA-256 of the cookie value is stored
create table if not exists sessions (
  token_hash   text primary key,
  owner_id     uuid not null references owners (id) on delete cascade,
  device       text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null
);
create index if not exists sessions_owner on sessions (owner_id);

create table if not exists login_attempts (
  id         bigserial primary key,
  ip         text,
  ok         boolean not null,
  at         timestamptz not null default now()
);
create index if not exists login_attempts_at on login_attempts (at);

-- ---------------------------------------------------------------- synced records (docs/DATA_MODEL.md)
create sequence if not exists records_seq;
create table if not exists records (
  owner_id       uuid    not null references owners (id) on delete cascade,
  coll           text    not null check (coll in ('tasks', 'goals', 'thoughts', 'checkins', 'meta')),
  id             text    not null check (length(id) between 1 and 128),
  updated_at     bigint  not null,
  deleted        boolean not null default false,
  data           jsonb   not null,
  schema_version int     not null default 1,
  seq            bigint  not null default nextval('records_seq'),
  server_ts      timestamptz not null default now(),
  primary key (owner_id, coll, id)
);
create index if not exists records_owner_seq on records (owner_id, seq);

create or replace function records_bump() returns trigger language plpgsql as $$
begin new.seq := nextval('records_seq'); new.server_ts := now(); return new; end $$;
drop trigger if exists records_bump on records;
create trigger records_bump before update on records for each row execute function records_bump();

-- current owner for this transaction (set by the API); null when unset
create or replace function app_owner() returns uuid language sql stable as $$
  select nullif(current_setting('app.owner_id', true), '')::uuid $$;

alter table records enable row level security;
alter table records force row level security;
drop policy if exists records_owner on records;
create policy records_owner on records using (owner_id = app_owner()) with check (owner_id = app_owner());

-- last-write-wins upsert used by POST /api/sync/push; returns the number of records applied
create or replace function steady_push(p_records jsonb) returns integer language plpgsql as $$
declare n integer;
begin
  if app_owner() is null then raise exception 'no owner in scope' using errcode = '42501'; end if;
  if jsonb_typeof(p_records) <> 'array' then raise exception 'p_records must be an array'; end if;
  with incoming as (
    select r->>'coll' as coll, r->>'id' as id, (r->>'updatedAt')::bigint as updated_at,
           coalesce((r->>'deleted')::boolean, false) as deleted, r->'data' as data,
           coalesce((r->>'schemaVersion')::int, 1) as schema_version
    from jsonb_array_elements(p_records) r
  ), applied as (
    insert into records as t (owner_id, coll, id, updated_at, deleted, data, schema_version)
    select app_owner(), coll, id, updated_at, deleted, data, schema_version from incoming
    on conflict (owner_id, coll, id) do update
      set updated_at = excluded.updated_at, deleted = excluded.deleted, data = excluded.data, schema_version = excluded.schema_version
      where excluded.updated_at > t.updated_at
         or (excluded.updated_at = t.updated_at and excluded.deleted and not t.deleted)
         or (excluded.updated_at = t.updated_at and excluded.deleted = t.deleted and excluded.data::text > t.data::text)
    returning 1
  )
  select count(*) into n from applied;
  return n;
end $$;
