-- For an existing database only. New installs use database.sql instead.
alter table public.awtar_users add column if not exists username text;
create unique index if not exists awtar_username_unique on public.awtar_users(lower(username));
alter table public.awtar_users add constraint awtar_username_format check(username is null or username ~ '^[a-z][a-z0-9_.-]{2,31}$');
-- Set your existing administrator username (only one administrator expected):
update public.awtar_users set username='omar' where role='admin' and username is null;
