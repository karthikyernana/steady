-- v1.2: real accounts. Email + password (scrypt) per owner; the private allow-list trigger is retired
-- (sign-up policy now lives in the API: SIGNUP_MODE=open|owners). Setup-code / single passphrase are retired too.
drop trigger if exists owners_allowlist on owners;
alter table owners add column if not exists password_hash text;
alter table owners add column if not exists name text;
alter table owners add column if not exists password_updated_at timestamptz;
create unique index if not exists owners_email_lower on owners (lower(email));
-- carry an existing owner passphrase over as that owner's password, so nobody is locked out
update owners o set password_hash = c.passphrase_hash, password_updated_at = c.updated_at
  from owner_credentials c where c.owner_id = o.id and o.password_hash is null;
create index if not exists login_attempts_ip_at on login_attempts (ip, at);
