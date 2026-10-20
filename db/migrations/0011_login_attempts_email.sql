-- v1.6: sign-in rate limits per IP and per account. The old instance-wide cap (20 failures an hour from anyone) let a
-- stranger lock every user out of signing in; failures now also count against the email they targeted.
alter table login_attempts add column if not exists email text;
create index if not exists login_attempts_email_at on login_attempts (email, at);
