create or replace function public.awtar_cash_cancel_topup(topup_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  manager public.awtar_users;
  state jsonb;
  topup jsonb;
  today date := (now() at time zone 'Asia/Baghdad')::date;
begin
  select * into manager from public.awtar_users
  where user_id = auth.uid() and role = 'admin';
  if not found then
    raise exception 'إلغاء التعزيز للمدير فقط';
  end if;

  select data into state from public.awtar_state where id = 1 for update;
  select e into topup
  from jsonb_array_elements(coalesce(state#>'{dailyFund,topups}', '[]')) e
  where e->>'id' = topup_id;
  if not found then
    raise exception 'التعزيز غير موجود أو ملغى مسبقاً. حدّث السجل.';
  end if;

  state := jsonb_set(state, '{dailyFund,topups}', (
    select coalesce(jsonb_agg(e order by position), '[]')
    from jsonb_array_elements(state#>'{dailyFund,topups}') with ordinality t(e, position)
    where e->>'id' is distinct from topup_id
  ));
  state := public.awtar_daily_reconcile(state, today);

  update public.awtar_state set data = state, revision = revision + 1 where id = 1;
  insert into public.awtar_audit (id, actor, actor_name, action, payload)
  values (gen_random_uuid(), auth.uid(), manager.name, 'cash_cancel_topup', topup);
  return topup;
end;
$function$;

revoke all on function public.awtar_cash_cancel_topup(text) from public, anon, authenticated;
grant execute on function public.awtar_cash_cancel_topup(text) to authenticated;
notify pgrst, 'reload schema';
