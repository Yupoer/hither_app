-- Account-wide free KML quota and scope-aware itinerary writers.
-- The quota is deliberately server-authoritative: opening the import sheet is
-- not a usage event; a successful batch is.

create table if not exists public.account_import_quotas (
  user_id uuid primary key references auth.users(id) on delete cascade,
  used_count integer not null default 0 check (used_count between 0 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Older production databases may not have the history migration that created
-- this conflict target; keep complete_gathering_stop deployable on both paths.
create unique index if not exists idx_visited_waypoints_group_dest_user
  on public.visited_waypoints (group_id, destination_id, user_id)
  where destination_id is not null and group_id is not null;

alter table public.account_import_quotas enable row level security;
drop policy if exists "account import quota: own read" on public.account_import_quotas;
create policy "account import quota: own read"
  on public.account_import_quotas for select to authenticated
  using (user_id = (select auth.uid()));
grant select on public.account_import_quotas to authenticated;

-- Existing free accounts enter the new policy exhausted, as requested. Premium
-- accounts retain a fresh free balance for the day their entitlement expires.
insert into public.account_import_quotas (user_id, used_count)
select u.id,
  case when coalesce(p.pro, false) and p.pro_expires_at is null then 0
       when exists (
         select 1
         from public.personal_premium_entitlements e
         where e.user_id = u.id
           and public.personal_premium_is_live(e.status, e.expires_at)
       ) then 0
       else 5
  end
from auth.users u
left join public.profiles p on p.id = u.id
on conflict (user_id) do nothing;

create or replace function public.can_manage_itinerary_scope(
  p_group_id uuid,
  p_subgroup_id uuid,
  p_user_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    left join public.subgroups s
      on s.id = p_subgroup_id
     and s.group_id = p_group_id
    where m.group_id = p_group_id
      and m.user_id = coalesce(p_user_id, (select auth.uid()))
      and (
        (p_subgroup_id is null and m.role = 'leader')
        or (
          p_subgroup_id is not null
          and m.subgroup_id = p_subgroup_id
          and s.leader_id = m.user_id
      )
    )
  )
  -- The optional id is used by the transaction-local import check only; do
  -- not expose another user's membership/leader status through this helper.
  and (p_user_id is null or p_user_id = (select auth.uid()))
  and public.anonymous_access_is_active(coalesce(p_user_id, (select auth.uid())));
$$;

revoke all on function public.can_manage_itinerary_scope(uuid, uuid, uuid) from public, anon;
grant execute on function public.can_manage_itinerary_scope(uuid, uuid, uuid) to authenticated;

-- A read-only route scope is visible to every group member. Allow a member to
-- propose a main-team stop, and allow the main leader to propose a stop for a
-- subgroup; only the target scope leader can approve or write it.
create or replace function public.submit_gather_point_request(
  p_group_id uuid,
  p_subgroup_id uuid,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.memberships;
  v_request_id uuid;
  v_item jsonb;
  v_lat double precision;
  v_lon double precision;
begin
  select m.* into v_member
  from public.memberships m
  where m.group_id = p_group_id and m.user_id = (select auth.uid());
  if not found then
    raise exception 'active membership required' using errcode = '42501';
  end if;
  if p_subgroup_id is not null and v_member.subgroup_id is distinct from p_subgroup_id
     and v_member.role <> 'leader' then
    raise exception 'request subgroup must match membership' using errcode = '42501';
  end if;
  if p_subgroup_id is not null and not exists (
    select 1 from public.subgroups s
    where s.id = p_subgroup_id and s.group_id = p_group_id
  ) then
    raise exception 'subgroup does not belong to group' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'items must contain 1 to 100 places' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or nullif(btrim(v_item->>'title'), '') is null
       or jsonb_typeof(v_item->'latitude') is distinct from 'number'
       or jsonb_typeof(v_item->'longitude') is distinct from 'number' then
      raise exception 'invalid gathering point' using errcode = '22023';
    end if;
    v_lat := (v_item->>'latitude')::double precision;
    v_lon := (v_item->>'longitude')::double precision;
    if v_lat not between -90 and 90 or v_lon not between -180 and 180 then
      raise exception 'invalid coordinates' using errcode = '22023';
    end if;
  end loop;

  insert into public.gather_point_requests(group_id, subgroup_id, requester_id, items)
  values (p_group_id, p_subgroup_id, (select auth.uid()), p_items)
  returning id into v_request_id;
  return v_request_id;
end;
$$;

revoke all on function public.submit_gather_point_request(uuid, uuid, jsonb) from public, anon;
grant execute on function public.submit_gather_point_request(uuid, uuid, jsonb) to authenticated;

-- Route subgroup proposals to that subgroup's leader. Main-team proposals keep
-- the existing leader broadcast; subgroup memberships use role=follower, so a
-- role-only recipient filter would otherwise never reach the sub-leader.
create or replace function public.on_gather_point_request_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_user_id uuid;
begin
  if new.subgroup_id is not null then
    select s.leader_id into v_target_user_id
    from public.subgroups s
    where s.id = new.subgroup_id
      and s.group_id = new.group_id;
  end if;
  perform extensions.notify_push(jsonb_build_object(
    'category', 'gathering_request',
    'group_id', new.group_id,
    'sender_id', new.requester_id,
    'target_user_id', v_target_user_id,
    'request_id', new.id,
    'title', coalesce(new.items->0->>'title', '集合點'),
    'count', jsonb_array_length(new.items)
  ));
  return new;
end;
$$;

revoke all on function public.on_gather_point_request_insert() from public, anon, authenticated;

drop policy if exists "gather requests: requester or leader reads" on public.gather_point_requests;
create policy "gather requests: requester or scope leader reads"
  on public.gather_point_requests for select to authenticated
  using (
    requester_id = (select auth.uid())
    or public.can_manage_itinerary_scope(group_id, subgroup_id)
  );

create or replace function public.get_kml_import_quota()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(0, 5 - coalesce(
    (select q.used_count
       from public.account_import_quotas q
      where q.user_id = (select auth.uid())),
    0
  ));
$$;

revoke all on function public.get_kml_import_quota() from public, anon;
grant execute on function public.get_kml_import_quota() to authenticated;

-- Replace the old main-leader-only policies. SECURITY INVOKER RPCs still pass
-- through these policies, so direct table updates cannot bypass scope roles.
drop policy if exists "itinerary_items: insert if leader" on public.itinerary_items;
drop policy if exists "itinerary_items: update if leader" on public.itinerary_items;
drop policy if exists "itinerary_items: delete if leader" on public.itinerary_items;
drop policy if exists "itinerary_items: insert if in that subgroup" on public.itinerary_items;
drop policy if exists "itinerary_items: update if in that subgroup" on public.itinerary_items;
drop policy if exists "itinerary_items: delete if in that subgroup" on public.itinerary_items;

create policy "itinerary_items: insert if scope leader"
  on public.itinerary_items for insert to authenticated
  with check (public.can_manage_itinerary_scope(group_id, subgroup_id));

create policy "itinerary_items: update if scope leader"
  on public.itinerary_items for update to authenticated
  using (public.can_manage_itinerary_scope(group_id, subgroup_id))
  with check (public.can_manage_itinerary_scope(group_id, subgroup_id));

create policy "itinerary_items: delete if scope leader"
  on public.itinerary_items for delete to authenticated
  using (public.can_manage_itinerary_scope(group_id, subgroup_id));

-- Keep the existing RPC return type. Validate the whole payload before taking
-- the quota lock, then increment only after every row has been inserted.
create or replace function public.import_itinerary_batch(
  p_group_id uuid,
  p_subgroup_id uuid,
  p_day integer,
  p_items jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_day integer := greatest(1, coalesce(p_day, 1));
  v_count integer;
  v_insert_pos integer;
  v_item jsonb;
  v_idx integer := 0;
  v_title text;
  v_lat double precision;
  v_lng double precision;
  v_is_premium boolean := false;
  v_quota_used integer;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_subgroup_id is not null and not exists (
    select 1 from public.subgroups s
    where s.id = p_subgroup_id and s.group_id = p_group_id
  ) then
    raise exception 'subgroup does not belong to group' using errcode = '22023';
  end if;
  if not public.can_manage_itinerary_scope(p_group_id, p_subgroup_id, v_uid) then
    raise exception 'scope leader membership required' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid import batch' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_items);
  if v_count = 0 then return 0; end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_title := nullif(trim(coalesce(v_item->>'title', '')), '');
    if v_title is null then
      raise exception 'invalid import item title' using errcode = '22023';
    end if;
    begin
      v_lat := (v_item->>'latitude')::double precision;
      v_lng := (v_item->>'longitude')::double precision;
    exception when others then
      raise exception 'invalid import item coordinates' using errcode = '22023';
    end;
    if v_lat is null or v_lng is null
      or v_lat < -90 or v_lat > 90
      or v_lng < -180 or v_lng > 180 then
      raise exception 'invalid import item coordinates' using errcode = '22023';
    end if;
  end loop;

  -- This lock serializes quota consumption for the account. The group lock
  -- below separately serializes itinerary positions.
  insert into public.account_import_quotas (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;
  select q.used_count into v_quota_used
  from public.account_import_quotas q
  where q.user_id = v_uid
  for update;

  v_is_premium := public.profile_has_lifetime_premium(v_uid)
    or exists (
      select 1
      from public.personal_premium_entitlements e
      where e.user_id = v_uid
        and public.personal_premium_is_live(e.status, e.expires_at)
    )
    or public.group_has_active_premium(p_group_id);
  if not v_is_premium and v_quota_used + v_count > 5 then
    raise exception 'kml import quota exceeded' using errcode = 'P0004';
  end if;

  perform 1 from public.groups g where g.id = p_group_id for update;
  if not found then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  select coalesce(max(i.position), -1) + 1 into v_insert_pos
  from public.itinerary_items i
  where i.group_id = p_group_id
    and ((p_subgroup_id is null and i.subgroup_id is null) or i.subgroup_id = p_subgroup_id)
    and coalesce(i.day, 1) = v_day;
  if not exists (
    select 1 from public.itinerary_items i
    where i.group_id = p_group_id
      and ((p_subgroup_id is null and i.subgroup_id is null) or i.subgroup_id = p_subgroup_id)
      and coalesce(i.day, 1) = v_day
  ) then
    select coalesce(max(i.position), -1) + 1 into v_insert_pos
    from public.itinerary_items i
    where i.group_id = p_group_id
      and ((p_subgroup_id is null and i.subgroup_id is null) or i.subgroup_id = p_subgroup_id)
      and coalesce(i.day, 1) < v_day;
  end if;
  v_insert_pos := coalesce(v_insert_pos, 0);

  update public.itinerary_items i
  set position = i.position + v_count
  where i.group_id = p_group_id
    and ((p_subgroup_id is null and i.subgroup_id is null) or i.subgroup_id = p_subgroup_id)
    and i.position >= v_insert_pos;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.itinerary_items (
      group_id, subgroup_id, title, address, day, latitude, longitude, position
    ) values (
      p_group_id, p_subgroup_id,
      nullif(trim(coalesce(v_item->>'title', '')), ''),
      nullif(trim(coalesce(v_item->>'address', '')), ''),
      v_day,
      (v_item->>'latitude')::double precision,
      (v_item->>'longitude')::double precision,
      v_insert_pos + v_idx
    );
    v_idx := v_idx + 1;
  end loop;

  if not v_is_premium then
    update public.account_import_quotas
    set used_count = used_count + v_count, updated_at = now()
    where user_id = v_uid;
  end if;
  return v_count;
end;
$$;

revoke all on function public.import_itinerary_batch(uuid, uuid, integer, jsonb) from public, anon;
grant execute on function public.import_itinerary_batch(uuid, uuid, integer, jsonb) to authenticated;

-- Scope leaders may mark/undo arrivals for their own subgroup. Keep the
-- existing arrival ordering/session side effects and only broaden the caller
-- authority from main-team role to the shared scope helper.
create or replace function public.set_destination_arrival(
  p_destination_id uuid,
  p_target_user_id uuid,
  p_arrived boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_destination public.itinerary_items;
  v_target_subgroup uuid;
  v_active_destination uuid;
  v_journey_status text;
  v_session_id uuid;
  v_departure date;
  v_trip_days integer;
  v_current_day integer;
begin
  select * into v_destination from public.itinerary_items where id = p_destination_id;
  if not found then raise exception 'destination not found' using errcode = 'P0002'; end if;

  if p_target_user_id is distinct from (select auth.uid())
     and not public.can_manage_itinerary_scope(
       v_destination.group_id, v_destination.subgroup_id
     ) then
    raise exception 'cannot mark this member' using errcode = '42501';
  end if;

  select m.subgroup_id into v_target_subgroup from public.memberships m
  where m.group_id = v_destination.group_id and m.user_id = p_target_user_id;
  if not found or v_target_subgroup is distinct from v_destination.subgroup_id then
    raise exception 'destination outside member scope' using errcode = '42501';
  end if;

  select g.active_destination_id, g.journey_status, g.departure_date, g.trip_days
  into v_active_destination, v_journey_status, v_departure, v_trip_days
  from public.groups g where g.id = v_destination.group_id;
  if v_journey_status = 'paused' and not p_arrived and not exists (
    select 1 from public.destination_arrivals a
    where a.destination_id = p_destination_id
  ) then
    raise exception 'paused destination requires an existing arrival' using errcode = '22023';
  end if;

  if v_departure is not null and v_trip_days is not null and v_trip_days > 0 then
    v_current_day := (current_date - v_departure) + 1;
  else
    v_current_day := null;
  end if;

  if p_arrived and exists (
    select 1
    from public.itinerary_items i
    where i.group_id = v_destination.group_id
      and i.subgroup_id is not distinct from v_destination.subgroup_id
      and i.position < v_destination.position
      and i.closed_at is null
      and not exists (
        select 1 from public.destination_arrivals a
        where a.destination_id = i.id and a.user_id = p_target_user_id
      )
      and (
        v_current_day is null
        or v_current_day <= 0
        or (
          v_current_day <= v_trip_days
          and coalesce(i.day, 1) >= v_current_day
        )
      )
  ) then
    raise exception 'future destination cannot be completed' using errcode = '22023';
  end if;

  if p_arrived then
    perform public.record_destination_arrival(
      v_destination.group_id, p_destination_id, p_target_user_id,
      'manual', (select auth.uid())
    );
    if v_active_destination = p_destination_id then
      update public.memberships set status = 'arrived'
      where group_id = v_destination.group_id and user_id = p_target_user_id;
    end if;
    select s.id into v_session_id
    from public.navigation_sessions s
    where s.destination_id = p_destination_id
      and s.group_id = v_destination.group_id
      and s.status in ('active', 'completed')
    order by s.started_at desc
    limit 1;
    if v_session_id is not null then
      update public.navigation_member_states
      set local_status = 'arrived', arrived_at = coalesce(arrived_at, now()),
          acknowledged_at = coalesce(acknowledged_at, now()), updated_at = now()
      where navigation_session_id = v_session_id and user_id = p_target_user_id;
    end if;
  else
    delete from public.destination_arrivals
    where destination_id = p_destination_id and user_id = p_target_user_id;
    if v_active_destination = p_destination_id then
      update public.memberships set status = 'active'
      where group_id = v_destination.group_id and user_id = p_target_user_id;
    end if;
    select s.id into v_session_id
    from public.navigation_sessions s
    where s.destination_id = p_destination_id
      and s.group_id = v_destination.group_id
      and s.status in ('active', 'completed')
    order by s.started_at desc
    limit 1;
    if v_session_id is not null then
      update public.navigation_member_states
      set local_status = case when v_destination.closed_at is null then 'pending' else 'missed' end,
          updated_at = now()
      where navigation_session_id = v_session_id and user_id = p_target_user_id;
    end if;
  end if;
end;
$$;

revoke all on function public.set_destination_arrival(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_destination_arrival(uuid, uuid, boolean) to authenticated;

-- Scope-aware delete. The SECURITY INVOKER RLS policy also remains a second
-- boundary for callers that reach the table through another path.
create or replace function public.delete_destination(
  p_group_id uuid,
  p_destination_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.itinerary_items;
  v_cancelled integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into v_item
  from public.itinerary_items i
  where i.id = p_destination_id and i.group_id = p_group_id
  for update;
  if not found then raise exception 'destination not found' using errcode = 'P0002'; end if;
  if not public.can_manage_itinerary_scope(p_group_id, v_item.subgroup_id) then
    raise exception 'scope leader membership required' using errcode = '42501';
  end if;
  update public.navigation_sessions s
  set status = 'cancelled', ended_at = now(), version = s.version + 1, updated_at = now()
  where s.group_id = p_group_id and s.destination_id = p_destination_id and s.status = 'active';
  get diagnostics v_cancelled = row_count;
  if v_cancelled > 0 or exists (
    select 1 from public.groups g where g.id = p_group_id and g.active_destination_id = p_destination_id
  ) then
    update public.groups g
    set journey_status = 'paused', active_destination_id = null, journey_started_at = null
    where g.id = p_group_id;
  end if;
  delete from public.itinerary_items i where i.id = p_destination_id and i.group_id = p_group_id;
end;
$$;

revoke all on function public.delete_destination(uuid, uuid) from public, anon;
grant execute on function public.delete_destination(uuid, uuid) to authenticated;

-- The existing completion side effects are retained; only the authority check
-- changes from group-wide leader to the destination's scope leader.
create or replace function public.complete_gathering_stop(
  p_group_id uuid,
  p_destination_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.itinerary_items;
  v_cancelled integer := 0;
  v_uid uuid := (select auth.uid());
  v_closed_at timestamptz;
  v_member record;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into v_item from public.itinerary_items i
  where i.id = p_destination_id and i.group_id = p_group_id for update;
  if not found then raise exception 'destination not found' using errcode = 'P0002'; end if;
  if not public.can_manage_itinerary_scope(p_group_id, v_item.subgroup_id, v_uid) then
    raise exception 'scope leader membership required' using errcode = '42501';
  end if;
  update public.navigation_sessions s
  set status = 'cancelled', ended_at = now(), version = s.version + 1, updated_at = now()
  where s.group_id = p_group_id and s.destination_id = p_destination_id and s.status = 'active';
  get diagnostics v_cancelled = row_count;
  if v_cancelled > 0 or exists (
    select 1 from public.groups g where g.id = p_group_id and g.active_destination_id = p_destination_id
  ) then
    update public.groups g
    set journey_status = 'paused', active_destination_id = null, journey_started_at = null
    where g.id = p_group_id;
  end if;
  update public.itinerary_items set closed_at = coalesce(closed_at, now())
  where id = p_destination_id and group_id = p_group_id returning closed_at into v_closed_at;
  insert into public.visited_waypoints (
    user_id, group_id, destination_id, arrival_id, name, latitude, longitude, arrived_at
  )
  select m.user_id, p_group_id, p_destination_id, a.id,
    coalesce(v_item.title, '集合點'), coalesce(v_item.latitude, 0), coalesce(v_item.longitude, 0),
    coalesce(a.arrived_at, v_closed_at, now())
  from public.memberships m
  left join public.destination_arrivals a
    on a.destination_id = p_destination_id and a.user_id = m.user_id
  where m.group_id = p_group_id
    and (v_item.subgroup_id is null or m.subgroup_id is not distinct from v_item.subgroup_id)
  on conflict (group_id, destination_id, user_id)
    where destination_id is not null and group_id is not null
  do update set name = excluded.name, latitude = excluded.latitude, longitude = excluded.longitude,
    arrival_id = coalesce(public.visited_waypoints.arrival_id, excluded.arrival_id);
  for v_member in select m.user_id from public.memberships m
    where m.group_id = p_group_id and m.user_id is distinct from v_uid
      and (v_item.subgroup_id is null or m.subgroup_id is not distinct from v_item.subgroup_id)
      and not exists (select 1 from public.destination_arrivals a
        where a.destination_id = p_destination_id and a.user_id = m.user_id)
  loop
    begin
      perform extensions.notify_push(jsonb_build_object(
        'category', 'journey', 'group_id', p_group_id, 'sender_id', v_uid,
        'target_user_id', v_member.user_id, 'destination_id', p_destination_id,
        'status', 'gathering_completed', 'title', v_item.title,
        'message', '隊長已完成此卡片，將前往下一個集合點'
      ));
    exception when others then null;
    end;
  end loop;
  begin
    perform extensions.notify_push(jsonb_build_object(
      'category', 'journey', 'group_id', p_group_id, 'sender_id', v_uid,
      'target_user_id', v_uid, 'destination_id', p_destination_id,
      'status', 'gathering_completed', 'title', v_item.title, 'message', '集合點已完成'
    ));
  exception when others then null;
  end;
end;
$$;

revoke all on function public.complete_gathering_stop(uuid, uuid) from public, anon;
grant execute on function public.complete_gathering_stop(uuid, uuid) to authenticated;

create or replace function public.resolve_gather_point_request(
  p_request_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.gather_point_requests;
  v_item jsonb;
  v_position integer;
  v_inserted integer := 0;
begin
  select * into v_request from public.gather_point_requests r where r.id = p_request_id for update;
  if not found then raise exception 'request not found' using errcode = 'P0002'; end if;
  if v_request.status <> 'pending' then raise exception 'request already resolved' using errcode = '23505'; end if;
  if not public.can_manage_itinerary_scope(v_request.group_id, v_request.subgroup_id) then
    raise exception 'scope leader membership required' using errcode = '42501';
  end if;
  if p_approve then
    perform 1 from public.groups g where g.id = v_request.group_id for update;
    if not found then raise exception 'group not found' using errcode = 'P0002'; end if;
    select coalesce(max(i.position), -1) into v_position
    from public.itinerary_items i
    where i.group_id = v_request.group_id
      and i.subgroup_id is not distinct from v_request.subgroup_id;
    for v_item in select value from jsonb_array_elements(v_request.items)
    loop
      v_position := v_position + 1;
      insert into public.itinerary_items(
        group_id, subgroup_id, title, address, day, latitude, longitude, position, created_by
      ) values (
        v_request.group_id, v_request.subgroup_id, btrim(v_item->>'title'),
        nullif(v_item->>'address', ''), greatest(1, coalesce((v_item->>'day')::integer, 1)),
        (v_item->>'latitude')::double precision, (v_item->>'longitude')::double precision,
        v_position, (select auth.uid())
      );
      v_inserted := v_inserted + 1;
    end loop;
  end if;
  update public.gather_point_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = (select auth.uid()), reviewed_at = now()
  where id = p_request_id;
  return jsonb_build_object(
    'status', case when p_approve then 'approved' else 'rejected' end,
    'inserted_count', v_inserted
  );
end;
$$;

revoke all on function public.resolve_gather_point_request(uuid, boolean) from public, anon;
grant execute on function public.resolve_gather_point_request(uuid, boolean) to authenticated;
