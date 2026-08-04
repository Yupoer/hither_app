-- Ticket 2: one authoritative recovery read for a group.
-- Realtime remains the fast path; this RPC is the 60-second/missed-event
-- recovery path and intentionally has no mutating fallback. The generation
-- timestamp is intentionally independent of core_entity_versions: existing
-- direct writes and member-location updates do not all create a core version,
-- while the client still needs a newer recovery response to clear a Realtime
-- revision fence.

create or replace function public.get_group_recovery_snapshot(p_group_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_member boolean;
  v_revision text := to_char(
    now() at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select exists(
    select 1 from public.memberships m
     where m.group_id = p_group_id and m.user_id = v_uid
  ) into v_is_member;
  if not v_is_member then
    raise exception 'not_member' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'schema_version', 'group-recovery-v1',
    'generated_at', now(),
    'realtime_revision', v_revision,
    'group', (
      select to_jsonb(g)
        from public.groups g
       where g.id = p_group_id
    ),
    'memberships', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.user_id)
        from public.memberships m
       where m.group_id = p_group_id
    ), '[]'::jsonb),
    'profiles', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.id)
        from public.profiles p
       where p.id in (
         select m.user_id from public.memberships m where m.group_id = p_group_id
       )
    ), '[]'::jsonb),
    'subgroups', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.id)
        from public.subgroups s
       where s.group_id = p_group_id
    ), '[]'::jsonb),
    'itinerary', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.position, i.id)
        from public.itinerary_items i
       where i.group_id = p_group_id
    ), '[]'::jsonb),
    'locations', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.user_id)
        from public.member_locations l
       where l.group_id = p_group_id
    ), '[]'::jsonb),
    'entity_versions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'entity_type', v.entity_type,
        'entity_id', v.entity_id,
        'entity_version', v.entity_version,
        'updated_at', v.updated_at,
        'state', v.state
      ) order by v.entity_type, v.entity_id)
        from public.core_entity_versions v
       where v.group_id = p_group_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_group_recovery_snapshot(uuid) from public, anon;
grant execute on function public.get_group_recovery_snapshot(uuid) to authenticated;

comment on function public.get_group_recovery_snapshot(uuid) is
  'Single read snapshot for recovery; callers must merge by realtime_revision/entity_version.';
