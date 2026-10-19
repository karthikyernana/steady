-- Read-only tokens for the Hark plugin (GET /api/hark/export). Only the SHA-256 hash is stored.
create table if not exists api_tokens (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references owners (id) on delete cascade,
  label        text not null default 'Hark',
  scope        text not null default 'read' check (scope = 'read'),
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
-- looked up by hash before an owner is known, so no RLS here; the API only ever selects by token_hash or owner_id
