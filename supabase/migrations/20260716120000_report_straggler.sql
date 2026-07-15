-- Leader-only distance straggler reports → APNs fan-out via notify_push.
-- Distance is judged on the leader device; this RPC only authorizes + fans out.

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
    select 1
    from public.memberships m
    where m.group_id = p_group_id
      and m.user_id = v_uid
      and m.role = 'leader'
  ) then
    raise exception 'leader role required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.memberships m
    where m.group_id = p_group_id
      and m.user_id = p_member_id
  ) then
    raise exception 'member not in group' using errcode = 'P0002';
  end if;

  select g.straggler_alerts
  into v_alerts
  from public.groups g
  where g.id = p_group_id;

  if v_alerts is distinct from true then
    return;
  end if;

  select nullif(trim(p.nickname), '')
  into v_member_name
  from public.profiles p
  where p.id = p_member_id;

  perform extensions.notify_push(jsonb_build_object(
    'category', 'straggler',
    'group_id', p_group_id,
    'sender_id', v_uid,
    'member_id', p_member_id,
    'member_name', coalesce(v_member_name, '隊友'),
    'distance_m', p_distance_m
  ));
end;
$$;

revoke all on function public.report_straggler(uuid, uuid, double precision)
  from public, anon;
grant execute on function public.report_straggler(uuid, uuid, double precision)
  to authenticated;
