-- v1.4: see and sign out devices. Where a session started and was last used (from Vercel's IP geo headers),
-- plus the browser/app it came from. Purely additive; old sessions just show "Unknown place".
alter table sessions add column if not exists user_agent text;
alter table sessions add column if not exists created_ip text;
alter table sessions add column if not exists created_place text;
alter table sessions add column if not exists last_ip text;
alter table sessions add column if not exists last_place text;
