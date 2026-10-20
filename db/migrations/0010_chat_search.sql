-- v1.6: Chat retrieval (hybrid search) + follow-up suggestions.
-- 1. agent_messages.suggestions: 0-3 short follow-up prompts stored with each assistant message.
-- 2. Full-text + trigram search over tasks / thoughts / money: an IMMUTABLE text extractor and two expression indexes
--    (GIN tsvector 'simple', GIN trigram). Both live on `records`, so its FORCE RLS policy still scopes every query.
-- 3. Optional semantic search: pgvector + record_embeddings (owner-scoped, FORCE RLS). Created only when the extension
--    can be installed; everything else works without it (the API checks for the table at runtime).
-- Additive only: no existing column, row or policy changes.

alter table agent_messages add column if not exists suggestions jsonb not null default '[]'::jsonb;

-- trusted extension on PG13+ (database owner may create it); Neon ships it
create extension if not exists pg_trgm;

-- the searchable text of a record (tasks: title + notes; thoughts: text + tags; money: note + payee + category)
create or replace function record_search_text(p_coll text, p_data jsonb) returns text
  language sql immutable parallel safe as $$
  select case p_coll
    when 'tasks'    then concat_ws(' ', p_data->>'title', p_data->>'notes', p_data->>'note')
    when 'thoughts' then concat_ws(' ', p_data->>'text', case when jsonb_typeof(p_data->'tags') = 'array'
                                      then (select string_agg(t, ' ') from jsonb_array_elements_text(p_data->'tags') t) end)
    when 'money'    then concat_ws(' ', p_data->>'note', p_data->>'payee', p_data->>'category')
    else '' end $$;

create index if not exists records_search_fts on records
  using gin (to_tsvector('simple'::regconfig, record_search_text(coll, data)))
  where coll in ('tasks', 'thoughts', 'money') and not deleted;
create index if not exists records_search_trgm on records
  using gin (record_search_text(coll, data) gin_trgm_ops)
  where coll in ('tasks', 'thoughts', 'money') and not deleted;

-- pgvector is optional: a database without it (or a role that may not create it) skips this block quietly
do $$
begin
  begin
    create extension if not exists vector;
  exception when others then
    raise notice 'pgvector unavailable (%), semantic search stays off', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'vector') then
    execute $sql$
      create table if not exists record_embeddings (
        owner_id   uuid not null,
        coll       text not null,
        id         text not null,
        hash       text not null,
        embedding  vector(768) not null,
        updated_at timestamptz not null default now(),
        primary key (owner_id, coll, id),
        foreign key (owner_id, coll, id) references records (owner_id, coll, id) on delete cascade
      ) $sql$;
    execute 'alter table record_embeddings enable row level security';
    execute 'alter table record_embeddings force row level security';
    execute 'drop policy if exists record_embeddings_owner on record_embeddings';
    execute 'create policy record_embeddings_owner on record_embeddings using (owner_id = app_owner()) with check (owner_id = app_owner())';
    begin
      execute 'create index if not exists record_embeddings_hnsw on record_embeddings using hnsw (embedding vector_cosine_ops)';
    exception when others then
      raise notice 'hnsw index skipped (%)', sqlerrm;
    end;
  end if;
end $$;
