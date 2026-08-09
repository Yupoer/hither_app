-- Parent #158 / #159 #160 #161
-- Daily accommodation (team+date snapshot) + account favorite places
-- + itinerary accommodation kind + team auto-add switch.
-- Expand-first: grants + RLS required for Data API exposure.
-- REVIEW_FIX: expiry-aware leader writes; serialize none→some auto-add;
-- stay_anchor for boundary lock downgrade on some→some / some→none.

-- ============================================================
-- groups.accommodation_auto_add (team-shared, default on)
-- ============================================================
alter table public.groups
  add column if not exists accommodation_auto_add boolean not null default true;

-- ============================================================
-- itinerary_items.kind — stop (default) | accommodation
-- ============================================================
alter table public.itinerary_items
  add column if not exists kind text not null default 'stop';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'itinerary_items_kind_check'
  ) then
    alter table public.itinerary_items
      add constraint itinerary_items_kind_check
      check (kind in ('stop', 'accommodation'));
  end if;
end $$;

comment on column public.itinerary_items.kind is
  'stop = gathering point; accommodation = independent stay snapshot card. Deleting a card never clears daily_accommodations.';

-- Boundary anchors from auto-add / pure-index after drop; cleared on daily change.
alter table public.itinerary_items
  add column if not exists stay_anchor boolean not null default false;

comment on column public.itinerary_items.stay_anchor is
  'When true and pure-index first/last accommodation of the day, card is boundary-locked. Cleared on some→some / some→none so cards become draggable mid.';

-- ============================================================
-- daily_accommodations — team + calendar date, at most one row
-- Snapshot only; not live-linked to source destination.
-- ============================================================
create table if not exists public.daily_accommodations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  -- Calendar date (YYYY-MM-DD) for the trip day; uniqueness is (group_id, stay_date).
  stay_date date not null,
  title text not null,
  address text,
  latitude double precision not null,
  longitude double precision not null,
  -- Optional source destination id at copy time (snapshot only; no FK live link).
  source_destination_id uuid,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, stay_date)
);

create index if not exists idx_daily_accommodations_group_id
  on public.daily_accommodations (group_id);

create index if not exists idx_daily_accommodations_group_date
  on public.daily_accommodations (group_id, stay_date);

comment on table public.daily_accommodations is
  'Per-team per-date accommodation snapshot. Independent of itinerary accommodation cards.';

alter table public.daily_accommodations enable row level security;

-- Members may read (expiry-aware is_member).
create policy "daily_accommodations: select if member"
  on public.daily_accommodations for select to authenticated
  using (extensions.is_member(group_id));

-- Leaders may write only while membership is active (expiry-aware).
-- Raw memberships.role='leader' alone is insufficient: expired anonymous
-- leaders retain a memberships row but is_member is false.
create policy "daily_accommodations: insert if leader"
  on public.daily_accommodations for insert to authenticated
  with check (
    extensions.is_member(group_id)
    and exists (
      select 1 from public.memberships m
      where m.group_id = daily_accommodations.group_id
        and m.user_id = (select auth.uid())
        and m.role = 'leader'
    )
  );

create policy "daily_accommodations: update if leader"
  on public.daily_accommodations for update to authenticated
  using (
    extensions.is_member(group_id)
    and exists (
      select 1 from public.memberships m
      where m.group_id = daily_accommodations.group_id
        and m.user_id = (select auth.uid())
        and m.role = 'leader'
    )
  )
  with check (
    extensions.is_member(group_id)
    and exists (
      select 1 from public.memberships m
      where m.group_id = daily_accommodations.group_id
        and m.user_id = (select auth.uid())
        and m.role = 'leader'
    )
  );

create policy "daily_accommodations: delete if leader"
  on public.daily_accommodations for delete to authenticated
  using (
    extensions.is_member(group_id)
    and exists (
      select 1 from public.memberships m
      where m.group_id = daily_accommodations.group_id
        and m.user_id = (select auth.uid())
        and m.role = 'leader'
    )
  );

grant select, insert, update, delete on public.daily_accommodations to authenticated;

-- Realtime for group refresh convergence.
do $$
begin
  alter publication supabase_realtime add table public.daily_accommodations;
exception
  when duplicate_object then null;
end $$;

-- ============================================================
-- account_favorite_places — account-owned, cross-team
-- Exact duplicate = same owner + name + normalized lat/lng
-- ============================================================
create table if not exists public.account_favorite_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  address text,
  latitude double precision not null,
  longitude double precision not null,
  -- Normalized coordinates for uniqueness (6 decimal places).
  lat_norm double precision not null,
  lng_norm double precision not null,
  title_norm text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, title_norm, lat_norm, lng_norm)
);

create index if not exists idx_account_favorite_places_user_id
  on public.account_favorite_places (user_id);

comment on table public.account_favorite_places is
  'Account-owned favorite places; not team data. RLS owner-only.';

alter table public.account_favorite_places enable row level security;

create policy "account_favorite_places: select own"
  on public.account_favorite_places for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "account_favorite_places: insert own"
  on public.account_favorite_places for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "account_favorite_places: update own"
  on public.account_favorite_places for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "account_favorite_places: delete own"
  on public.account_favorite_places for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.account_favorite_places to authenticated;

-- ============================================================
-- Privileged daily-accommodation mutations live in non-exposed
-- `extensions` schema (SECURITY DEFINER). Public Data API surface
-- is SECURITY INVOKER wrappers only (#159 / REVIEW_FIX r2).
-- ============================================================

-- Atomic set + none→some auto-add (DEFINER body).
create or replace function extensions.set_daily_accommodation_with_auto_add(
  p_group_id uuid,
  p_stay_date date,
  p_title text,
  p_address text,
  p_latitude double precision,
  p_longitude double precision,
  p_source_destination_id uuid default null,
  p_day int default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_leader boolean;
  v_auto_add boolean;
  v_previous_exists boolean;
  v_row public.daily_accommodations%rowtype;
  v_day int;
  v_min_pos int;
  v_max_pos int;
  v_first_id uuid;
  v_last_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Expiry-aware active membership first, then leader role.
  -- Expired anonymous leaders fail is_member even with memberships.role=leader.
  if not extensions.is_member(p_group_id) then
    raise exception 'not_leader';
  end if;

  select exists(
    select 1 from public.memberships m
    where m.group_id = p_group_id
      and m.user_id = v_uid
      and m.role = 'leader'
  ) into v_is_leader;

  if not v_is_leader then
    raise exception 'not_leader';
  end if;

  -- Serialize concurrent none→some for this group so two callers cannot both
  -- observe absence and double-insert first/last cards.
  select coalesce(g.accommodation_auto_add, true)
    into v_auto_add
  from public.groups g
  where g.id = p_group_id
  for update;

  if not found then
    raise exception 'group_not_found';
  end if;

  select exists(
    select 1 from public.daily_accommodations d
    where d.group_id = p_group_id and d.stay_date = p_stay_date
  ) into v_previous_exists;

  insert into public.daily_accommodations as d (
    group_id, stay_date, title, address, latitude, longitude,
    source_destination_id, created_by, updated_at
  ) values (
    p_group_id, p_stay_date, p_title, p_address, p_latitude, p_longitude,
    p_source_destination_id, v_uid, now()
  )
  on conflict (group_id, stay_date) do update set
    title = excluded.title,
    address = excluded.address,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    source_destination_id = excluded.source_destination_id,
    updated_at = now()
  returning * into v_row;

  v_day := coalesce(p_day, 1);

  -- some→some: downgrade existing stay anchors so pure-index locks release.
  if v_previous_exists then
    update public.itinerary_items i
      set stay_anchor = false
    where i.group_id = p_group_id
      and i.subgroup_id is null
      and coalesce(i.day, 1) = v_day
      and i.kind = 'accommodation'
      and i.stay_anchor = true;
  end if;

  -- Auto-add only on none → some while switch is on (under group lock).
  -- Any failure below rolls back the whole transaction including the upsert.
  if (not v_previous_exists) and v_auto_add then
    select coalesce(min(i.position), 0), coalesce(max(i.position), -1)
      into v_min_pos, v_max_pos
    from public.itinerary_items i
    where i.group_id = p_group_id
      and i.subgroup_id is null
      and coalesce(i.day, 1) = v_day;

    -- Make room at the front of this day: shift same-day and later positions.
    update public.itinerary_items i
      set position = i.position + 1
    where i.group_id = p_group_id
      and i.subgroup_id is null
      and i.position >= v_min_pos;

    insert into public.itinerary_items (
      group_id, title, address, latitude, longitude, position, day, kind, stay_anchor
    ) values (
      p_group_id, p_title, p_address, p_latitude, p_longitude, v_min_pos, v_day, 'accommodation', true
    ) returning id into v_first_id;

    select coalesce(max(i.position), v_min_pos)
      into v_max_pos
    from public.itinerary_items i
    where i.group_id = p_group_id
      and i.subgroup_id is null
      and coalesce(i.day, 1) = v_day;

    update public.itinerary_items i
      set position = i.position + 1
    where i.group_id = p_group_id
      and i.subgroup_id is null
      and i.position > v_max_pos;

    insert into public.itinerary_items (
      group_id, title, address, latitude, longitude, position, day, kind, stay_anchor
    ) values (
      p_group_id, p_title, p_address, p_latitude, p_longitude, v_max_pos + 1, v_day, 'accommodation', true
    ) returning id into v_last_id;
  end if;

  return jsonb_build_object(
    'daily', to_jsonb(v_row),
    'auto_added', (not v_previous_exists) and v_auto_add,
    'first_card_id', v_first_id,
    'last_card_id', v_last_id
  );
end;
$$;

-- Atomic clear + stay_anchor downgrade (DEFINER body). All-or-nothing.
create or replace function extensions.clear_daily_accommodation_with_downgrade(
  p_group_id uuid,
  p_stay_date date,
  p_day int default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_leader boolean;
  v_day int;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if not extensions.is_member(p_group_id) then
    raise exception 'not_leader';
  end if;

  select exists(
    select 1 from public.memberships m
    where m.group_id = p_group_id
      and m.user_id = v_uid
      and m.role = 'leader'
  ) into v_is_leader;

  if not v_is_leader then
    raise exception 'not_leader';
  end if;

  -- Same group-row serialization as set path (concurrent set/clear races).
  perform 1 from public.groups g where g.id = p_group_id for update;
  if not found then
    raise exception 'group_not_found';
  end if;

  delete from public.daily_accommodations d
  where d.group_id = p_group_id
    and d.stay_date = p_stay_date;

  -- some→none: release pure-index boundary locks for the trip day.
  v_day := coalesce(nullif(p_day, 0), 1);
  update public.itinerary_items i
    set stay_anchor = false
  where i.group_id = p_group_id
    and i.subgroup_id is null
    and coalesce(i.day, 1) = v_day
    and i.kind = 'accommodation'
    and i.stay_anchor = true;
end;
$$;

-- Public wrappers: SECURITY INVOKER, Data API entry points only.
-- Drop any prior public DEFINER overload from earlier PR revisions.
drop function if exists public.set_daily_accommodation_with_auto_add(
  uuid, date, text, text, double precision, double precision, uuid, int
);

create or replace function public.set_daily_accommodation_with_auto_add(
  p_group_id uuid,
  p_stay_date date,
  p_title text,
  p_address text,
  p_latitude double precision,
  p_longitude double precision,
  p_source_destination_id uuid default null,
  p_day int default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select extensions.set_daily_accommodation_with_auto_add(
    p_group_id,
    p_stay_date,
    p_title,
    p_address,
    p_latitude,
    p_longitude,
    p_source_destination_id,
    p_day
  );
$$;

create or replace function public.clear_daily_accommodation_with_downgrade(
  p_group_id uuid,
  p_stay_date date,
  p_day int default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform extensions.clear_daily_accommodation_with_downgrade(
    p_group_id,
    p_stay_date,
    p_day
  );
end;
$$;

revoke all on function extensions.set_daily_accommodation_with_auto_add(
  uuid, date, text, text, double precision, double precision, uuid, int
) from public;
revoke all on function extensions.clear_daily_accommodation_with_downgrade(
  uuid, date, int
) from public;
-- Callers reach DEFINER only via public INVOKER wrappers (or direct SQL grants).
grant execute on function extensions.set_daily_accommodation_with_auto_add(
  uuid, date, text, text, double precision, double precision, uuid, int
) to authenticated;
grant execute on function extensions.clear_daily_accommodation_with_downgrade(
  uuid, date, int
) to authenticated;

revoke all on function public.set_daily_accommodation_with_auto_add(
  uuid, date, text, text, double precision, double precision, uuid, int
) from public;
revoke all on function public.clear_daily_accommodation_with_downgrade(
  uuid, date, int
) from public;
grant execute on function public.set_daily_accommodation_with_auto_add(
  uuid, date, text, text, double precision, double precision, uuid, int
) to authenticated;
grant execute on function public.clear_daily_accommodation_with_downgrade(
  uuid, date, int
) to authenticated;

comment on function extensions.set_daily_accommodation_with_auto_add is
  'Privileged DEFINER body (non-exposed schema). Leader-only expiry-aware; group FOR UPDATE; atomic none→some auto-add; some→some stay_anchor clear.';
comment on function extensions.clear_daily_accommodation_with_downgrade is
  'Privileged DEFINER body. Leader-only expiry-aware; group FOR UPDATE; delete daily row + stay_anchor downgrade in one transaction.';
comment on function public.set_daily_accommodation_with_auto_add is
  'SECURITY INVOKER Data API wrapper → extensions.set_daily_accommodation_with_auto_add.';
comment on function public.clear_daily_accommodation_with_downgrade is
  'SECURITY INVOKER Data API wrapper → extensions.clear_daily_accommodation_with_downgrade. Atomic some→none.';

-- ============================================================
-- accommodation_auto_add toggle — must not use legacy groups UPDATE
-- policy alone (role=leader without is_member). Expired anonymous
-- leaders retain memberships.role=leader and could flip the switch
-- via Data API; route through expiry-aware RPC instead.
-- ============================================================

create or replace function extensions.set_accommodation_auto_add(
  p_group_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_leader boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Expiry-aware active membership first (expired anon fails here).
  if not extensions.is_member(p_group_id) then
    raise exception 'not_leader';
  end if;

  select exists(
    select 1 from public.memberships m
    where m.group_id = p_group_id
      and m.user_id = v_uid
      and m.role = 'leader'
  ) into v_is_leader;

  if not v_is_leader then
    raise exception 'not_leader';
  end if;

  update public.groups g
     set accommodation_auto_add = coalesce(p_enabled, true)
   where g.id = p_group_id;

  if not found then
    raise exception 'group_not_found';
  end if;
end;
$$;

drop function if exists public.set_accommodation_auto_add(uuid, boolean);

create or replace function public.set_accommodation_auto_add(
  p_group_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform extensions.set_accommodation_auto_add(p_group_id, p_enabled);
end;
$$;

revoke all on function extensions.set_accommodation_auto_add(uuid, boolean) from public;
grant execute on function extensions.set_accommodation_auto_add(uuid, boolean) to authenticated;
revoke all on function public.set_accommodation_auto_add(uuid, boolean) from public;
grant execute on function public.set_accommodation_auto_add(uuid, boolean) to authenticated;

comment on function extensions.set_accommodation_auto_add is
  'Privileged DEFINER body. Leader-only expiry-aware toggle for groups.accommodation_auto_add.';
comment on function public.set_accommodation_auto_add is
  'SECURITY INVOKER Data API wrapper → extensions.set_accommodation_auto_add. Do not write groups.accommodation_auto_add via legacy role-only UPDATE policy.';
