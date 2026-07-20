-- Persist straggler detections as a short-lived group event.
-- The row gives Realtime a durable fallback when APNs/FCM is unavailable;
-- the trigger keeps the existing server push path and recipient filtering.
create table public.group_alerts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  kind text not null default 'straggler' check (kind = 'straggler'),
  sender_id uuid not null references auth.users(id) on delete cascade,
  member_id uuid not null references auth.users(id) on delete cascade,
  member_name text not null default '',
  distance_m double precision,
  created_at timestamptz not null default now()
);

create index group_alerts_group_created_idx
  on public.group_alerts(group_id, created_at desc);

alter table public.group_alerts enable row level security;

create policy "group_alerts: select if member"
  on public.group_alerts for select to authenticated
  using (extensions.is_member(group_id));

grant select on public.group_alerts to authenticated;
alter publication supabase_realtime add table public.group_alerts;
alter table public.group_alerts replica identity full;

create or replace function public.on_group_alert_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform extensions.notify_push(jsonb_build_object(
    'category', new.kind,
    'group_id', new.group_id,
    'sender_id', new.sender_id,
    'member_id', new.member_id,
    'member_name', new.member_name,
    'distance_m', new.distance_m
  ));
  return new;
end;
$$;

drop trigger if exists trg_group_alert_insert on public.group_alerts;
create trigger trg_group_alert_insert
  after insert on public.group_alerts
  for each row execute function public.on_group_alert_insert();

revoke execute on function public.on_group_alert_insert() from public, anon, authenticated;

-- Keep the leader-only authorization and hysteresis decision on the client,
-- but make the resulting event visible to both Realtime and send-push.
create or replace function public.report_straggler(
  p_group_id uuid,
  p_member_id uuid,
  p_distance_m double precision default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_member_name text;
  v_alerts boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id
      and m.user_id = v_uid
      and m.role = 'leader'
  ) then
    raise exception 'leader role required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id and m.user_id = p_member_id
  ) then
    raise exception 'member not in group' using errcode = 'P0002';
  end if;

  select g.straggler_alerts into v_alerts
  from public.groups g where g.id = p_group_id;
  if v_alerts is distinct from true then return; end if;

  select nullif(trim(p.nickname), '') into v_member_name
  from public.profiles p where p.id = p_member_id;

  insert into public.group_alerts(
    group_id, kind, sender_id, member_id, member_name, distance_m
  ) values (
    p_group_id, 'straggler', v_uid, p_member_id,
    coalesce(v_member_name, '成員'), p_distance_m
  );
end;
$$;

revoke all on function public.report_straggler(uuid, uuid, double precision)
  from public, anon;
grant execute on function public.report_straggler(uuid, uuid, double precision)
  to authenticated;
