-- v1.5 (phase 1 of the agent layer): Chat. One agent answers questions about the user's own data with read-only tools
-- and replies with text + cards. Cards are stored as QUERY specs (tool + params + binding), never as numbers; the API
-- recomputes their figures from `records` whenever a chat is shown. Chats are plain API data (not part of record sync).
-- Every table is owner-scoped with FORCE ROW LEVEL SECURITY on app.owner_id, like records / agent_memory.

create table if not exists agent_chats (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references owners (id) on delete cascade,
  title      text not null default 'New chat' check (length(title) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agent_chats_owner_updated on agent_chats (owner_id, updated_at desc);
alter table agent_chats enable row level security;
alter table agent_chats force row level security;
drop policy if exists agent_chats_owner on agent_chats;
create policy agent_chats_owner on agent_chats using (owner_id = app_owner()) with check (owner_id = app_owner());

create table if not exists agent_messages (
  id         bigserial primary key,
  chat_id    uuid not null references agent_chats (id) on delete cascade,
  owner_id   uuid not null references owners (id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  text       text not null default '' check (length(text) <= 4000),
  cards      jsonb not null default '[]'::jsonb check (jsonb_typeof(cards) = 'array'),
  meta       jsonb not null default '{}'::jsonb,
  cache_key  text,
  created_at timestamptz not null default now()
);
create index if not exists agent_messages_chat on agent_messages (chat_id, id);
create index if not exists agent_messages_cache on agent_messages (owner_id, cache_key, created_at) where cache_key is not null;
alter table agent_messages enable row level security;
alter table agent_messages force row level security;
drop policy if exists agent_messages_owner on agent_messages;
-- a message must belong to this owner AND sit in one of this owner's chats
create policy agent_messages_owner on agent_messages using (owner_id = app_owner())
  with check (owner_id = app_owner() and exists (select 1 from agent_chats c where c.id = chat_id and c.owner_id = app_owner()));

-- the daily cap counts chat turns in the existing usage tables
alter table agent_usage drop constraint if exists agent_usage_kind_check;
alter table agent_usage add constraint agent_usage_kind_check check (kind in ('stt', 'plan', 'chat'));
alter table agent_usage_total drop constraint if exists agent_usage_total_kind_check;
alter table agent_usage_total add constraint agent_usage_total_kind_check check (kind in ('stt', 'plan', 'chat'));
