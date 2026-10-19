-- Owner passphrase (scrypt hash only). Set once through the one-time setup code, changeable when signed in.
create table if not exists owner_credentials (
  owner_id        uuid primary key references owners (id) on delete cascade,
  passphrase_hash text not null,
  updated_at      timestamptz not null default now()
);
-- marks that the one-time setup code has been used, so it can never be replayed
create table if not exists setup_state (
  id         boolean primary key default true check (id),
  claimed_at timestamptz not null default now()
);
