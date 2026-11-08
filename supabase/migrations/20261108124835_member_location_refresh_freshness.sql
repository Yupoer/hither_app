create or replace function public.request_group_location_refresh(p_group_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_now timestamptz := now();
  v_requested_at timestamptz;
  v_retry integer;
  v_recipient_ids uuid[];
begin
  if v_uid is null or not extensions.is_member(p_group_id) then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  -- Serialize only the existing cooldown row so concurrent requests cannot
  -- fan out two refresh waves inside the same 60-second window.
  insert into public.location_refresh_requests(group_id, requested_by, requested_at)
  values (p_group_id, v_uid, v_now)
  on conflict (group_id) do nothing;

  if not found then
    select r.requested_at
      into v_requested_at
      from public.location_refresh_requests r
     where r.group_id = p_group_id
       for update;

    if v_requested_at > v_now - interval '60 seconds' then
      v_retry := greatest(
        0,
        ceil(extract(epoch from (v_requested_at + interval '60 seconds' - v_now)))
      )::integer;
      return jsonb_build_object('accepted', false, 'retry_after_seconds', v_retry, 'requested_at', v_requested_at);
    end if;

    update public.location_refresh_requests
       set requested_by = v_uid, requested_at = v_now
     where group_id = p_group_id;
  end if;

  select coalesce(array_agg(m.user_id order by m.user_id), '{}'::uuid[])
    into v_recipient_ids
    from public.memberships m
   where m.group_id = p_group_id
     and m.user_id <> v_uid
     and coalesce((select p.sharing_enabled from public.member_privacy_settings p where p.user_id = m.user_id), true)
     and coalesce(m.status, 'active') <> 'offline'
     and public.anonymous_access_is_active(m.user_id)
     and not exists (
       select 1 from public.member_locations l
        where l.group_id = m.group_id and l.user_id = m.user_id
          and l.latitude is not null and l.longitude is not null
          and coalesce(l.captured_at, l.updated_at) > v_now - interval '180 seconds'
          and coalesce(l.captured_at, l.updated_at) <= v_now + interval '2 minutes'
     );

  insert into public.location_refresh_pending(group_id, user_id, requested_by, requested_at)
  select p_group_id, recipients.user_id, v_uid, v_now
    from unnest(v_recipient_ids) as recipients(user_id)
  on conflict (group_id, user_id) do update
        set requested_by = excluded.requested_by,
            requested_at = excluded.requested_at;

  if cardinality(v_recipient_ids) > 0 then
    perform extensions.notify_push(jsonb_build_object(
      'category', 'location_refresh',
      'group_id', p_group_id,
      'sender_id', v_uid,
      'recipient_ids', to_jsonb(v_recipient_ids)
    ));
  end if;

  return jsonb_build_object(
    'accepted', true,
    'requested_at', v_now,
    'retry_after_seconds', 60,
    'recipient_ids', to_jsonb(v_recipient_ids)
  );
end;
$$;
