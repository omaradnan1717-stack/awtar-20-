begin;
-- Dedicated role; existing employee permissions continue to exclude cashiers.
alter table public.awtar_users drop constraint if exists awtar_users_role_check;
alter table public.awtar_users add constraint awtar_users_role_check check(role in ('admin','employee','cashier'));
create table if not exists public.awtar_cashier_shifts(
 id uuid primary key, cashier uuid not null references public.awtar_users(user_id),
 work_date date not null, label text not null check(length(label) between 1 and 50),
 opening bigint not null default 0 check(opening>=0), source_id uuid unique references public.awtar_cashier_shifts(id),
 total bigint, master bigint, retained bigint, next_cashier uuid references public.awtar_users(user_id),
 closed boolean not null default false, created_at timestamptz not null default now(), closed_at timestamptz,
 unique(cashier,work_date,label)
);
create unique index if not exists awtar_cashier_one_open on public.awtar_cashier_shifts(cashier) where not closed;
alter table public.awtar_cashier_shifts enable row level security;
grant select on public.awtar_cashier_shifts to authenticated;
drop policy if exists cashier_shift_read on public.awtar_cashier_shifts;
create policy cashier_shift_read on public.awtar_cashier_shifts for select to authenticated using(public.awtar_admin() or cashier=auth.uid() or next_cashier=auth.uid());
create or replace function public.awtar_cashier_users() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',user_id,'name',name)),'[]') from public.awtar_users where role='cashier' and exists(select 1 from public.awtar_users where user_id=auth.uid() and role in ('admin','cashier'));
$$;
create or replace function public.awtar_cashier_shift(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.awtar_users; r public.awtar_cashier_shifts; src public.awtar_cashier_shifts; st jsonb; additions jsonb='[]'; vtotal bigint; vm bigint; vr bigint; nextid uuid; request uuid; note text;
begin
 select * into u from public.awtar_users where user_id=auth.uid();
 if u.role is distinct from 'cashier' then raise exception 'الدخول لحساب كاشير فقط'; end if;
 -- Serialize all shift operations with the existing accounting state lock.
 select data into st from public.awtar_state where id=1 for update;
 request=(p->>'id')::uuid;
 if action='open' then
  select * into r from public.awtar_cashier_shifts where id=request;
  if found then if r.cashier<>u.user_id then raise exception 'غير مخول'; end if; return to_jsonb(r); end if;
  if nullif(p->>'source','') is not null then
   select * into src from public.awtar_cashier_shifts where id=(p->>'source')::uuid for update;
   if not found or not src.closed or src.next_cashier<>u.user_id or src.retained<=0 then raise exception 'تسليم غير متاح'; end if;
  end if;
  insert into public.awtar_cashier_shifts(id,cashier,work_date,label,opening,source_id)
   values(request,u.user_id,(p->>'date')::date,trim(p->>'label'),coalesce(src.retained,0),src.id) returning * into r;
 elsif action='close' then
  select * into r from public.awtar_cashier_shifts where id=request for update;
  if not found or r.cashier<>u.user_id then raise exception 'غير مخول'; end if;
  if r.closed then return to_jsonb(r); end if;
  vtotal=(p->>'total')::bigint; vm=(p->>'master')::bigint; vr=(p->>'retained')::bigint; nextid=nullif(p->>'next','')::uuid;
  if vtotal is null or vm is null or vr is null or vtotal<0 or vm<0 or vm>vtotal or vr<0 or vr>r.opening+vtotal-vm or vtotal>1000000000000 then raise exception 'مبالغ غير صحيحة'; end if;
  if vr>0 and (nextid is null or nextid=u.user_id or not exists(select 1 from public.awtar_users where user_id=nextid and role='cashier')) then raise exception 'اختر الكاشير التالي'; end if;
  note='مطابقة كاشير: '||u.name||' — شفت '||r.label;
  if vtotal-vm>0 then additions=additions||jsonb_build_array(jsonb_build_object('id','shift_cash_'||r.id,'type','income','date',r.work_date,'amount',vtotal-vm,'method','نقدي','category','مبيعات الكاشير','note',note,'shiftId',r.id,'created',extract(epoch from now())*1000)); end if;
  if vm>0 then additions=additions||jsonb_build_array(jsonb_build_object('id','shift_master_'||r.id,'type','income','date',r.work_date,'amount',vm,'method','ماستر كارد','category','مبيعات الكاشير','note',note,'shiftId',r.id,'created',extract(epoch from now())*1000)); end if;
  update public.awtar_state set data=jsonb_set(st,'{entries}',(st->'entries')||additions),revision=revision+1 where id=1;
  update public.awtar_cashier_shifts set total=vtotal,master=vm,retained=vr,next_cashier=case when vr>0 then nextid else null end,closed=true,closed_at=now() where id=r.id returning * into r;
 else raise exception 'عملية غير متاحة'; end if;
 insert into public.awtar_audit(actor,actor_name,action,payload) values(u.user_id,u.name,'cashier_'||action,to_jsonb(r));
 return to_jsonb(r);
end $$;
revoke all on function public.awtar_cashier_shift(text,jsonb),public.awtar_cashier_users() from public,anon;
grant execute on function public.awtar_cashier_shift(text,jsonb),public.awtar_cashier_users() to authenticated;
-- Existing employee operations must not accept the new cashier role.
DO $guard$
declare f record; definition text;
begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
 where n.nspname='public' and l.lanname='plpgsql' and p.proname in ('awtar_record','awtar_cash_delete','awtar_cash_opening','awtar_cash_record','awtar_cash_record_dated','awtar_cash_summary','awtar_employee_debt','awtar_material_invoice') loop
  definition=pg_get_functiondef(f.oid);
  if position('cashier_role_guard' in definition)=0 then
   definition=regexp_replace(definition,'\mbegin\M', $body$begin /* cashier_role_guard */ if exists(select 1 from public.awtar_users where user_id=auth.uid() and role='cashier') then raise exception 'غير مخول لهذه العملية'; end if;$body$, 'i');
   execute definition;
  end if;
 end loop;
end $guard$;
create or replace function public.awtar_accounts() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p->>'id','name',p->>'name','balance',coalesce((select sum(case when m->>'kind'='add' then (m->>'amount')::numeric else -(m->>'amount')::numeric end) from jsonb_array_elements(p->'movements') m),0))),'[]') from public.awtar_state s, jsonb_array_elements(s.data->'parties') p where s.id=1 and p->>'type'='debt' and exists(select 1 from public.awtar_users where user_id=auth.uid() and role in ('admin','employee'))
$$;
commit;
