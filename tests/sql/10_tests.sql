-- Assertions for allowlist, RLS isolation, anon lockout, LWW push, cursors and tokens. Fails loudly on the first problem.
\set ON_ERROR_STOP on
create or replace function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin if not cond then raise exception 'FAIL: %', label; end if; raise notice 'PASS: %', label; end $$;

-- allowlist
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'karthikyernana@gmail.com');
do $$ begin
  begin insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222', 'intruder@example.com');
        raise exception 'FAIL: allowlist let a stranger sign up';
  exception when insufficient_privilege then raise notice 'PASS: allowlist rejects other emails'; end;
  begin update auth.users set email = 'other@example.com' where id = '11111111-1111-1111-1111-111111111111';
        raise exception 'FAIL: allowlist let the email change';
  exception when insufficient_privilege then raise notice 'PASS: allowlist blocks changing the email'; end;
end $$;
-- a second user that bypasses the trigger (e.g. inserted by an admin) to prove RLS isolation
alter table auth.users disable trigger steady_allowlist;
insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333', 'karthikyernana+other@gmail.com');
alter table auth.users enable trigger steady_allowlist;

-- as Karthik
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select pg_temp.ok(public.steady_push('[{"coll":"tasks","id":"a","updatedAt":100,"data":{"id":"a","title":"v1","updatedAt":100}},
                                       {"coll":"tasks","id":"b","updatedAt":100,"data":{"id":"b","title":"b","updatedAt":100}}]') = 2, 'push inserts new records');
select pg_temp.ok(public.steady_push('[{"coll":"tasks","id":"a","updatedAt":90,"data":{"id":"a","title":"older","updatedAt":90}}]') = 0, 'older write is ignored');
select pg_temp.ok((select data->>'title' from public.records where id = 'a') = 'v1', 'older write did not clobber');
select max(seq) as c0 from public.records \gset
select pg_temp.ok(public.steady_push('[{"coll":"tasks","id":"a","updatedAt":200,"data":{"id":"a","title":"v2","updatedAt":200}}]') = 1, 'newer write wins');
select pg_temp.ok((select seq from public.records where id = 'a') > :c0, 'update bumps the change cursor');
select pg_temp.ok((select count(*) from public.records where seq > :c0) = 1, 'incremental pull returns only changed rows');
select pg_temp.ok(public.steady_push('[{"coll":"tasks","id":"b","updatedAt":100,"deleted":true,"data":{"id":"b","deleted":true,"updatedAt":100}}]') = 1, 'tombstone wins a tie');
select pg_temp.ok(public.steady_push('[{"coll":"tasks","id":"b","updatedAt":100,"data":{"id":"b","title":"zzz","updatedAt":100}}]') = 0, 'live record does not beat a tombstone on a tie');
do $$ begin
  begin perform public.steady_push('[{"coll":"evil","id":"x","updatedAt":1,"data":{}}]'); raise exception 'FAIL: bad collection accepted';
  exception when check_violation then raise notice 'PASS: unknown collection rejected'; end;
end $$;
insert into public.scheduled_notifications (key, fire_at, title) values ('st-a', now() + interval '1 hour', 'Post on LinkedIn');
insert into public.push_subscriptions (endpoint, p256dh, auth, device) values ('https://push.example/1', 'k', 'a', 'Android');
select public.create_read_token('Hark') as tok \gset
select pg_temp.ok(:'tok' like 'stdy_%' and length(:'tok') = 53, 'read token created once, plaintext returned');
select pg_temp.ok((select count(*) from public.api_tokens) = 1 and (select token_hash from public.api_tokens) <> :'tok', 'only the token hash is stored');
do $$ begin
  begin insert into public.records (owner_id, coll, id, updated_at, data) values ('33333333-3333-3333-3333-333333333333', 'tasks', 'spoof', 1, '{}');
        raise exception 'FAIL: wrote a row for another owner';
  exception when insufficient_privilege then raise notice 'PASS: cannot write rows for another owner'; end;
end $$;

-- as another authenticated user: sees nothing of Karthik's
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select pg_temp.ok((select count(*) from public.records) = 0, 'RLS: other user sees no records');
select pg_temp.ok((select count(*) from public.scheduled_notifications) = 0, 'RLS: other user sees no reminders');
select pg_temp.ok((select count(*) from public.push_subscriptions) = 0, 'RLS: other user sees no push subscriptions');
select pg_temp.ok((select count(*) from public.api_tokens) = 0, 'RLS: other user sees no tokens');
update public.records set data = '{"hacked":true}';
select pg_temp.ok(not exists (select 1 from public.records), 'RLS: other user cannot update');

-- anon: no access at all
reset role; set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  begin perform 1 from public.records; raise exception 'FAIL: anon can read records';
  exception when insufficient_privilege then raise notice 'PASS: anon cannot read records'; end;
  begin perform public.steady_push('[]'); raise exception 'FAIL: anon can push';
  exception when insufficient_privilege then raise notice 'PASS: anon cannot call steady_push'; end;
  begin perform 1 from public.push_subscriptions; raise exception 'FAIL: anon can read subscriptions';
  exception when insufficient_privilege then raise notice 'PASS: anon cannot read push subscriptions'; end;
  begin perform public.create_read_token('x'); raise exception 'FAIL: anon can mint tokens';
  exception when insufficient_privilege then raise notice 'PASS: anon cannot mint tokens'; end;
end $$;

-- rescheduling resets sent_at
reset role;
update public.scheduled_notifications set sent_at = now();
update public.scheduled_notifications set fire_at = fire_at + interval '5 min';
select pg_temp.ok((select sent_at is null from public.scheduled_notifications where key = 'st-a'), 'rescheduling a sent reminder re-arms it');
-- every public table has RLS forced
select pg_temp.ok(not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity)), 'RLS enabled + forced on every public table');
