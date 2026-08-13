-- Durable per-recipient location refresh requests.
-- The existing location_refresh_requests row remains the group-wide 60s
-- cooldown.  This table is the delivery ledger: one versioned row per
-- recipient survives a missed APNs/FCM wake until that recipient ACKs it.

create table if not exists public.location_refresh_pending (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null,
  primary key (group_id, user_id)
);

alter table public.location_refresh_pending enable row level security;
revoke all on table public.location_refresh_pending from public, anon, authenticated;

create or replace function public.request_group_location_refresh(
  p_group_id uuid
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
      return jsonb_build_object('accepted', false, 'retry_after_seconds', v_retry);
    end if;

    update public.location_refresh_requests
       set requested_by = v_uid, requested_at = v_now
     where group_id = p_group_id;
  end if;

  -- This is the single expiry-aware recipient set shared with the durable
  -- ledger, the Edge fan-out, and the initiator's response accounting.
  select coalesce(array_agg(m.user_id order by m.user_id), '{}'::uuid[])
    into v_recipient_ids
    from public.memberships m
   where m.group_id = p_group_id
     and m.user_id <> v_uid
     and coalesce(m.status, 'active') <> 'offline'
     and public.anonymous_access_is_active(m.user_id);

  insert into public.location_refresh_pending(group_id, user_id, requested_by, requested_at)
  select p_group_id, recipients.user_id, v_uid, v_now
    from unnest(v_recipient_ids) as recipients(user_id)
  on conflict (group_id, user_id) do update
        set requested_by = excluded.requested_by,
            requested_at = excluded.requested_at;

  perform extensions.notify_push(jsonb_build_object(
    'category', 'location_refresh',
    'group_id', p_group_id,
    'sender_id', v_uid,
    'recipient_ids', to_jsonb(v_recipient_ids)
  ));

  return jsonb_build_object(
    'accepted', true,
    'retry_after_seconds', 60,
    'recipient_ids', to_jsonb(v_recipient_ids)
  );
end;
$$;

create or replace function public.list_my_pending_location_refreshes()
returns table (
  group_id uuid,
  requested_by uuid,
  requested_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select p.group_id, p.requested_by, p.requested_at
    from public.location_refresh_pending p
   where p.user_id = (select auth.uid())
     and extensions.is_member(p.group_id)
   order by p.requested_at asc;
$$;

create or replace function public.ack_my_location_refresh(
  p_group_id uuid,
  p_requested_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.location_refresh_pending
   where group_id = p_group_id
     and user_id = (select auth.uid())
     and requested_at = p_requested_at
     and extensions.is_member(p_group_id);
  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;

revoke all on function public.request_group_location_refresh(uuid)
  from public, anon, authenticated;
revoke all on function public.list_my_pending_location_refreshes()
  from public, anon, authenticated;
revoke all on function public.ack_my_location_refresh(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.request_group_location_refresh(uuid) to authenticated;
grant execute on function public.list_my_pending_location_refreshes() to authenticated;
grant execute on function public.ack_my_location_refresh(uuid, timestamptz) to authenticated;

comment on table public.location_refresh_pending is
  'Per-recipient durable location refresh ledger; access only through explicit SECURITY DEFINER RPCs.';
