-- Apply once in the existing Supabase project using SQL Editor.
-- Only new notifications are affected. Existing triggers and webhook stay in place.
begin;
create or replace function public.awtar_queue_notice() returns trigger language plpgsql security definer set search_path='' as $$
declare who uuid; actor_role text; actor_name text; source text;
 notice_title text := 'مطعم وكافيه أوتار';
 notice_body text; purchase jsonb; item_name text; amount_text text;
begin
 if tg_table_name='awtar_audit' then
  who=new.actor; source='audit:'||new.id::text;
 else
  who=auth.uid(); source=tg_table_name||':'||new.id::text;
 end if;
 select role,name into actor_role,actor_name from public.awtar_users where user_id=who;
 if actor_role is null then return new; end if;
 notice_body := case when actor_role='admin' then
  'سجّلت الإدارة تحديثاً جديداً في أوتار. افتح البرنامج لمراجعة الحسابات المتاحة لك.'
 else coalesce(actor_name,'الموظف')||' سجّل حركة جديدة في أوتار. افتح البرنامج لمراجعة التفاصيل.' end;
 if tg_table_name='awtar_audit' and actor_role='employee' then
  if new.action='credit_receipt' then
   item_name := nullif(btrim(substring(new.payload->>'note' from '^شراء آجل: (.*?) — ')), '');
   amount_text := new.payload->>'amount';
  else
   -- Fund expenses store the item in the accounting entry's category.
   purchase := new.payload;
   if purchase->>'type' is distinct from 'expense' or nullif(btrim(purchase->>'category'),'') is null then
    select entry into purchase
    from public.awtar_state s
    cross join lateral jsonb_array_elements(s.data->'entries') as entries(entry)
    where s.id=1 and entry->>'id'=new.id::text and entry->>'type'='expense'
    limit 1;
   end if;
   item_name := nullif(btrim(purchase->>'category'),'');
   amount_text := purchase->>'amount';
  end if;
 end if;
 if item_name is not null and amount_text ~ '^[0-9]{1,16}$' then
  notice_title := 'صرفيات أوتار';
  notice_body := case when new.action='credit_receipt' then 'شراء آجل: ' else 'شراء: ' end
   || left(regexp_replace(item_name,'[[:space:]]+',' ','g'),100)
   || ' • ' || to_char(amount_text::numeric,'FM9,999,999,999,999,990') || ' د.ع'
   || ' • ' || left(coalesce(nullif(actor_name,''),'الموظف'),60);
 end if;
 insert into public.awtar_notice_events(recipient,source_id,title,body)
 select user_id,source,
   case when role='admin' then notice_title else 'مطعم وكافيه أوتار' end,
   case when role='admin' or notice_title='مطعم وكافيه أوتار' then notice_body
        else coalesce(actor_name,'الموظف')||' سجّل حركة جديدة في أوتار. افتح البرنامج لمراجعة التفاصيل.' end
 from public.awtar_users where user_id<>who and role<>actor_role
 on conflict(recipient,source_id) do nothing;
 return new;
end $$;
revoke all on function public.awtar_queue_notice() from public,anon,authenticated;
commit;
