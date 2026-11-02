begin;
create table if not exists public.awtar_push_links (
 endpoint text primary key, user_id uuid not null references auth.users(id) on delete cascade,
 subscription jsonb not null, updated_at timestamptz not null default now()
);
create table if not exists public.awtar_notice_events (
 id uuid primary key default gen_random_uuid(), recipient uuid not null references auth.users(id) on delete cascade,
 source_id text not null, title text not null, body text not null, created_at timestamptz not null default now(),
 unique(recipient,source_id)
);
alter table public.awtar_push_links enable row level security;
alter table public.awtar_notice_events enable row level security;
revoke all on public.awtar_push_links,public.awtar_notice_events from anon,authenticated;
grant select on public.awtar_notice_events to authenticated;
grant all on public.awtar_push_links,public.awtar_notice_events to service_role;
drop policy if exists own_notices on public.awtar_notice_events;
create policy own_notices on public.awtar_notice_events for select to authenticated using (
 recipient=auth.uid() and exists(select 1 from public.awtar_users where user_id=auth.uid())
);
create index if not exists awtar_notice_recipient_time on public.awtar_notice_events(recipient,created_at desc);
create or replace function public.awtar_queue_notice() returns trigger language plpgsql security definer set search_path='' as $$
declare who uuid; actor_role text; actor_name text; source text;
begin
 if tg_table_name='awtar_audit' then
  who=new.actor; source='audit:'||new.id::text;
 else
  who=auth.uid(); source=tg_table_name||':'||new.id::text;
 end if;
 select role,name into actor_role,actor_name from public.awtar_users where user_id=who;
 if actor_role is null then return new; end if;
 insert into public.awtar_notice_events(recipient,source_id,title,body)
 select user_id,source,'مطعم وكافيه أوتار',
 case when actor_role='admin' then 'سجّلت الإدارة تحديثاً جديداً في أوتار. افتح البرنامج لمراجعة الحسابات المتاحة لك.'
 else coalesce(actor_name,'الموظف')||' سجّل حركة جديدة في أوتار. افتح البرنامج لمراجعة التفاصيل.' end
 from public.awtar_users where user_id<>who and role<>actor_role
 on conflict(recipient,source_id) do nothing;
 return new;
end $$;
revoke all on function public.awtar_queue_notice() from public,anon,authenticated;
drop trigger if exists awtar_notice_audit on public.awtar_audit;
create trigger awtar_notice_audit after insert on public.awtar_audit for each row execute function public.awtar_queue_notice();
-- Optional attachments tables: no historical events are sent.
do $$ begin
 if to_regclass('public.awtar_invoices') is not null then
  execute 'drop trigger if exists awtar_notice_invoice on public.awtar_invoices';
  execute 'create trigger awtar_notice_invoice after insert on public.awtar_invoices for each row execute function public.awtar_queue_notice()';
 end if;
end $$;
commit;
-- Next: configure an INSERT Database Webhook on awtar_notice_events to awtar-notify,
-- with x-awtar-webhook-secret set to the same AW TAR secret configured on the server.
