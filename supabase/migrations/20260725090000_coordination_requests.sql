-- OTA-09: Coordination requests with deadline, resolution policy, and
-- versioned itinerary apply. Participant responses are independent of
-- navigation technical state. Unanswered is neither consent nor rejection.
-- Opening a request never blocks start_navigation_session.
--
-- Version allocation is serialized per group via pg_advisory_xact_lock so
-- concurrent closes of different requests cannot collide on (group_id, version).

-- ── Versioned itinerary operations (append-only audit / apply log) ───────────

create table if not exists public.itinerary_operations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  subgroup_id uuid references public.subgroups(id) on delete set null,
  version bigint not null,
  operation_type text not null check (
    operation_type in (
      'coordination_apply',
      'coordination_no_change',
      'manual'
    )
  ),
  payload jsonb not null default '{}'::jsonb,
  source_request_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (group_id, version)
);

create index if not exists idx_itinerary_operations_group_created
  on public.itinerary_operations(group_id, created_at desc);

alter table public.itinerary_operations enable row level security;

create policy "itinerary_operations: members read"
  on public.itinerary_operations for select to authenticated
  using (extensions.is_member(group_id));

grant select on public.itinerary_operations to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.itinerary_operations;
exception when duplicate_object then null;
end;
$$;

-- ── Coordination requests ───────────────────────────────────────────────────

create table if not exists public.coordination_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  subgroup_id uuid references public.subgroups(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  -- Human-readable subject line (e.g. "Change gathering point for Day 2").
  subject text not null check (char_length(btrim(subject)) between 1 and 200),
  -- Domain of the change; options carry the concrete payload.
  subject_kind text not null check (
    subject_kind in ('gathering_point', 'meet_time', 'route', 'itinerary')
  ),
  -- Array of option objects: [{ id, label, kind, payload }]
  options jsonb not null check (
    jsonb_typeof(options) = 'array'
    and jsonb_array_length(options) between 1 and 20
  ),
  deadline timestamptz not null,
  policy text not null check (
    policy in (
      'organizer_override',
      'unanimity',
      'majority',
      'timeout_default'
    )
  ),
  -- Option id applied when policy cannot choose a winner (or on timeout).
  default_outcome text not null,
  status text not null default 'open' check (
    status in ('open', 'resolved', 'expired', 'cancelled')
  ),
  -- Null while open; also null when cancelled (abort is not a decided option).
  resolved_outcome text,
  resolution_source text check (
    resolution_source is null
    or resolution_source in (
      'organizer_override',
      'unanimity',
      'majority',
      'timeout_default',
      'cancelled'
    )
  ),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  applied_operation_id uuid references public.itinerary_operations(id)
    on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (deadline > created_at),
  check (
    (status = 'open' and resolved_outcome is null and resolved_at is null)
    or (status <> 'open')
  )
);

create index if not exists idx_coordination_requests_group_status
  on public.coordination_requests(group_id, status, deadline);

create index if not exists idx_coordination_requests_open_deadline
  on public.coordination_requests(deadline)
  where status = 'open';

alter table public.coordination_requests enable row level security;

create policy "coordination_requests: members read"
  on public.coordination_requests for select to authenticated
  using (extensions.is_member(group_id));

grant select on public.coordination_requests to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.coordination_requests;
exception when duplicate_object then null;
end;
$$;

-- FK from operations.source_request_id once requests exist.
alter table public.itinerary_operations
  drop constraint if exists itinerary_operations_source_request_id_fkey;
alter table public.itinerary_operations
  add constraint itinerary_operations_source_request_id_fkey
  foreign key (source_request_id)
  references public.coordination_requests(id)
  on delete set null;

-- ── Participant responses (separate from navigation technical state) ────────

create table if not exists public.coordination_responses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.coordination_requests(id)
    on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Chosen option id. Row exists only when the member has responded;
  -- unanswered remains absence of a row (never synthetic consent/reject).
  option_id text not null check (char_length(btrim(option_id)) between 1 and 100),
  responded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, user_id)
);

create index if not exists idx_coordination_responses_request
  on public.coordination_responses(request_id);

alter table public.coordination_responses enable row level security;

create policy "coordination_responses: members read"
  on public.coordination_responses for select to authenticated
  using (
    exists (
      select 1 from public.coordination_requests r
      where r.id = coordination_responses.request_id
        and extensions.is_member(r.group_id)
    )
  );

grant select on public.coordination_responses to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.coordination_responses;
exception when duplicate_object then null;
end;
$$;

-- ── Helpers ─────────────────────────────────────────────────────────────────

-- Eligible participants: any group member for main-scope requests;
-- subgroup members + group leaders for subgroup-scoped requests.
create or replace function public.coordination_user_eligible(
  p_group_id uuid,
  p_subgroup_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id
      and m.user_id = p_user_id
      and (
        p_subgroup_id is null
        or m.subgroup_id is not distinct from p_subgroup_id
        or m.role = 'leader'
      )
  );
$$;

create or replace function public.coordination_option_ids(p_options jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    array_agg(btrim(elem->>'id') order by ord),
    array[]::text[]
  )
  from jsonb_array_elements(p_options) with ordinality as t(elem, ord)
  where nullif(btrim(elem->>'id'), '') is not null;
$$;

create or replace function public.coordination_validate_options(
  p_options jsonb,
  p_default_outcome text
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_elem jsonb;
  v_ids text[] := array[]::text[];
  v_id text;
begin
  if jsonb_typeof(p_options) <> 'array'
     or jsonb_array_length(p_options) not between 1 and 20 then
    raise exception 'options must contain 1 to 20 entries' using errcode = '22023';
  end if;

  for v_elem in select value from jsonb_array_elements(p_options)
  loop
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'each option must be an object' using errcode = '22023';
    end if;
    v_id := nullif(btrim(v_elem->>'id'), '');
    if v_id is null then
      raise exception 'option id required' using errcode = '22023';
    end if;
    if nullif(btrim(v_elem->>'label'), '') is null then
      raise exception 'option label required' using errcode = '22023';
    end if;
    if v_id = any(v_ids) then
      raise exception 'duplicate option id' using errcode = '22023';
    end if;
    v_ids := array_append(v_ids, v_id);
  end loop;

  if nullif(btrim(p_default_outcome), '') is null
     or not (p_default_outcome = any(v_ids)) then
    raise exception 'default_outcome must match an option id'
      using errcode = '22023';
  end if;
end;
$$;

-- Pure resolution of a closed request given responses + policy.
-- Unanswered members are never treated as consent or rejection.
-- Callers must pass only eligible responses (defense-in-depth filter at resolve).
create or replace function public.coordination_compute_outcome(
  p_policy text,
  p_default_outcome text,
  p_eligible_user_ids uuid[],
  p_response_user_ids uuid[],
  p_response_option_ids text[]
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_n integer;
  v_i integer;
  v_opt text;
  v_counts jsonb := '{}'::jsonb;
  v_best text := null;
  v_best_count integer := 0;
  v_tie boolean := false;
  v_count integer;
  v_unique text;
  v_all_responded boolean;
begin
  v_n := coalesce(array_length(p_response_option_ids, 1), 0);

  if p_policy in ('timeout_default', 'organizer_override') then
    return jsonb_build_object(
      'option_id', p_default_outcome,
      'source', 'timeout_default'
    );
  end if;

  if p_policy = 'unanimity' then
    if v_n = 0 then
      return jsonb_build_object(
        'option_id', p_default_outcome,
        'source', 'timeout_default'
      );
    end if;

    v_unique := p_response_option_ids[1];
    for v_i in 2..v_n loop
      if p_response_option_ids[v_i] is distinct from v_unique then
        -- Conflicting responses → default. Silence is not a vote either way.
        return jsonb_build_object(
          'option_id', p_default_outcome,
          'source', 'timeout_default'
        );
      end if;
    end loop;

    -- Every eligible member must have responded with the same option.
    v_all_responded := true;
    if coalesce(array_length(p_eligible_user_ids, 1), 0) = 0 then
      v_all_responded := false;
    else
      for v_i in 1..array_length(p_eligible_user_ids, 1) loop
        if not (p_eligible_user_ids[v_i] = any(p_response_user_ids)) then
          v_all_responded := false;
          exit;
        end if;
      end loop;
    end if;

    if v_all_responded then
      return jsonb_build_object(
        'option_id', v_unique,
        'source', 'unanimity'
      );
    end if;

    return jsonb_build_object(
      'option_id', p_default_outcome,
      'source', 'timeout_default'
    );
  end if;

  if p_policy = 'majority' then
    if v_n = 0 then
      return jsonb_build_object(
        'option_id', p_default_outcome,
        'source', 'timeout_default'
      );
    end if;

    for v_i in 1..v_n loop
      v_opt := p_response_option_ids[v_i];
      v_count := coalesce((v_counts->>v_opt)::integer, 0) + 1;
      v_counts := jsonb_set(v_counts, array[v_opt], to_jsonb(v_count));
    end loop;

    for v_opt in select key from jsonb_each_text(v_counts)
    loop
      v_count := (v_counts->>v_opt)::integer;
      if v_count > v_best_count then
        v_best := v_opt;
        v_best_count := v_count;
        v_tie := false;
      elsif v_count = v_best_count then
        v_tie := true;
      end if;
    end loop;

    -- Strict majority of responders; unanswered are excluded from the tally.
    if not v_tie and v_best is not null and v_best_count > (v_n::numeric / 2) then
      return jsonb_build_object(
        'option_id', v_best,
        'source', 'majority'
      );
    end if;

    return jsonb_build_object(
      'option_id', p_default_outcome,
      'source', 'timeout_default'
    );
  end if;

  return jsonb_build_object(
    'option_id', p_default_outcome,
    'source', 'timeout_default'
  );
end;
$$;

-- Apply a chosen option as a new versioned itinerary operation.
-- Never rewrites destination_arrivals / visited_waypoints history.
-- Serializes version allocation per group (advisory xact lock).
create or replace function public.coordination_apply_outcome(
  p_request public.coordination_requests,
  p_option_id text,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_option jsonb;
  v_kind text;
  v_payload jsonb;
  v_version bigint;
  v_op_id uuid;
  v_op_type text := 'coordination_no_change';
  v_dest_id uuid;
  v_position integer;
  v_lat double precision;
  v_lon double precision;
  v_title text;
  v_address text;
  v_day integer;
  v_meet_at timestamptz;
  v_applied jsonb := jsonb_build_object('option_id', p_option_id);
begin
  select value into v_option
  from jsonb_array_elements(p_request.options) elem(value)
  where btrim(value->>'id') = p_option_id
  limit 1;

  if v_option is null then
    raise exception 'resolved option not found in request options'
      using errcode = '22023';
  end if;

  v_kind := coalesce(nullif(btrim(v_option->>'kind'), ''), 'keep_current');
  v_payload := coalesce(v_option->'payload', '{}'::jsonb);

  if v_kind in ('keep_current', 'reject', 'no_change') then
    v_op_type := 'coordination_no_change';
    v_applied := v_applied || jsonb_build_object('applied', false, 'kind', v_kind);
  elsif v_kind = 'meet_time' then
    v_dest_id := nullif(v_payload->>'destinationId', '')::uuid;
    if v_dest_id is null then
      raise exception 'meet_time option requires destinationId'
        using errcode = '22023';
    end if;
    v_meet_at := nullif(v_payload->>'meetAt', '')::timestamptz;

    update public.itinerary_items i
    set meet_at = v_meet_at
    where i.id = v_dest_id
      and i.group_id = p_request.group_id
      and i.subgroup_id is not distinct from p_request.subgroup_id
      and i.closed_at is null;

    if not found then
      -- Do not mutate closed history stops.
      v_op_type := 'coordination_no_change';
      v_applied := v_applied || jsonb_build_object(
        'applied', false,
        'kind', v_kind,
        'reason', 'destination_missing_or_closed'
      );
    else
      v_op_type := 'coordination_apply';
      v_applied := v_applied || jsonb_build_object(
        'applied', true,
        'kind', v_kind,
        'destination_id', v_dest_id,
        'meet_at', v_meet_at
      );
    end if;
  elsif v_kind in ('gathering_point', 'itinerary', 'route') then
    v_dest_id := nullif(v_payload->>'destinationId', '')::uuid;
    v_title := nullif(btrim(v_payload->>'title'), '');
    v_address := nullif(v_payload->>'address', '');
    v_lat := nullif(v_payload->>'latitude', '')::double precision;
    if v_lat is null and jsonb_typeof(v_payload->'latitude') = 'number' then
      v_lat := (v_payload->>'latitude')::double precision;
    end if;
    v_lon := nullif(v_payload->>'longitude', '')::double precision;
    if v_lon is null and jsonb_typeof(v_payload->'longitude') = 'number' then
      v_lon := (v_payload->>'longitude')::double precision;
    end if;
    v_day := greatest(1, coalesce(nullif(v_payload->>'day', '')::integer, 1));

    -- Bounds check for any non-null coordinates (update and insert paths).
    if (v_lat is not null and v_lat not between -90 and 90)
       or (v_lon is not null and v_lon not between -180 and 180) then
      raise exception 'invalid coordinates' using errcode = '22023';
    end if;

    if v_dest_id is not null then
      -- Update an open stop only; closed stops are history and stay untouched.
      update public.itinerary_items i
      set title = coalesce(v_title, i.title),
          address = case
            when v_payload ? 'address' then v_address
            else i.address
          end,
          latitude = coalesce(v_lat, i.latitude),
          longitude = coalesce(v_lon, i.longitude),
          day = coalesce(
            nullif(v_payload->>'day', '')::integer,
            i.day
          ),
          meet_at = case
            when v_payload ? 'meetAt' then nullif(v_payload->>'meetAt', '')::timestamptz
            else i.meet_at
          end
      where i.id = v_dest_id
        and i.group_id = p_request.group_id
        and i.subgroup_id is not distinct from p_request.subgroup_id
        and i.closed_at is null;

      if found then
        v_op_type := 'coordination_apply';
        v_applied := v_applied || jsonb_build_object(
          'applied', true,
          'kind', v_kind,
          'destination_id', v_dest_id,
          'mode', 'update'
        );
      else
        v_op_type := 'coordination_no_change';
        v_applied := v_applied || jsonb_build_object(
          'applied', false,
          'kind', v_kind,
          'reason', 'destination_missing_or_closed'
        );
      end if;
    elsif v_title is not null and v_lat is not null and v_lon is not null then
      select coalesce(max(i.position), -1) into v_position
      from public.itinerary_items i
      where i.group_id = p_request.group_id
        and i.subgroup_id is not distinct from p_request.subgroup_id;

      insert into public.itinerary_items(
        group_id, subgroup_id, title, address, day,
        latitude, longitude, position, created_by, meet_at
      ) values (
        p_request.group_id,
        p_request.subgroup_id,
        v_title,
        v_address,
        v_day,
        v_lat,
        v_lon,
        v_position + 1,
        p_actor,
        nullif(v_payload->>'meetAt', '')::timestamptz
      )
      returning id into v_dest_id;

      v_op_type := 'coordination_apply';
      v_applied := v_applied || jsonb_build_object(
        'applied', true,
        'kind', v_kind,
        'destination_id', v_dest_id,
        'mode', 'insert'
      );
    else
      v_op_type := 'coordination_no_change';
      v_applied := v_applied || jsonb_build_object(
        'applied', false,
        'kind', v_kind,
        'reason', 'insufficient_payload'
      );
    end if;
  else
    v_op_type := 'coordination_no_change';
    v_applied := v_applied || jsonb_build_object(
      'applied', false,
      'kind', v_kind,
      'reason', 'unknown_kind'
    );
  end if;

  -- Serialize version allocation for this group across concurrent closes.
  -- Namespace 87125009 = 'hither itinerary_operations' fixed key.
  perform pg_advisory_xact_lock(87125009, hashtext(p_request.group_id::text));

  select coalesce(max(o.version), 0) + 1 into v_version
  from public.itinerary_operations o
  where o.group_id = p_request.group_id;

  insert into public.itinerary_operations(
    group_id, subgroup_id, version, operation_type, payload,
    source_request_id, created_by
  ) values (
    p_request.group_id,
    p_request.subgroup_id,
    v_version,
    v_op_type,
    v_applied || jsonb_build_object(
      'request_id', p_request.id,
      'subject', p_request.subject,
      'subject_kind', p_request.subject_kind,
      'option', v_option
    ),
    p_request.id,
    p_actor
  )
  returning id into v_op_id;

  return v_op_id;
end;
$$;

-- Atomically close a request and apply the outcome once.
create or replace function public.coordination_close_request(
  p_request_id uuid,
  p_option_id text,
  p_source text,
  p_actor uuid,
  p_status text default null
)
returns public.coordination_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.coordination_requests;
  v_closed public.coordination_requests;
  v_op_id uuid;
  v_status text;
begin
  select * into v_request
  from public.coordination_requests r
  where r.id = p_request_id
  for update;
  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;

  -- Idempotent: repeated triggers return the already-closed row.
  if v_request.status <> 'open' then
    return v_request;
  end if;

  if p_option_id is null
     or not (p_option_id = any(public.coordination_option_ids(v_request.options))) then
    raise exception 'invalid outcome option' using errcode = '22023';
  end if;

  v_status := coalesce(
    p_status,
    case when p_source = 'timeout_default' then 'expired' else 'resolved' end
  );

  v_op_id := public.coordination_apply_outcome(v_request, p_option_id, p_actor);

  update public.coordination_requests
  set status = v_status,
      resolved_outcome = p_option_id,
      resolution_source = p_source,
      resolved_at = now(),
      resolved_by = p_actor,
      applied_operation_id = v_op_id,
      updated_at = now()
  where id = p_request_id
    and status = 'open'
  returning * into v_closed;

  if not found then
    -- Lost the race to another closer; return authoritative closed row.
    select * into v_closed
    from public.coordination_requests
    where id = p_request_id;
  end if;

  return v_closed;
end;
$$;

-- ── Public RPCs ─────────────────────────────────────────────────────────────

create or replace function public.create_coordination_request(
  p_group_id uuid,
  p_subgroup_id uuid,
  p_subject text,
  p_subject_kind text,
  p_options jsonb,
  p_deadline timestamptz,
  p_policy text,
  p_default_outcome text
)
returns public.coordination_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.coordination_requests;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id
      and m.user_id = (select auth.uid())
      and m.role = 'leader'
  ) then
    raise exception 'leader membership required' using errcode = '42501';
  end if;

  if p_subgroup_id is not null and not exists (
    select 1 from public.subgroups s
    where s.id = p_subgroup_id and s.group_id = p_group_id
  ) then
    raise exception 'subgroup does not belong to group' using errcode = '42501';
  end if;

  -- Any group leader may target the main list or any subgroup (top-down model).
  if nullif(btrim(p_subject), '') is null then
    raise exception 'subject required' using errcode = '22023';
  end if;

  if p_subject_kind not in ('gathering_point', 'meet_time', 'route', 'itinerary') then
    raise exception 'invalid subject_kind' using errcode = '22023';
  end if;

  if p_policy not in (
    'organizer_override', 'unanimity', 'majority', 'timeout_default'
  ) then
    raise exception 'invalid policy' using errcode = '22023';
  end if;

  if p_deadline is null or p_deadline <= now() then
    raise exception 'deadline must be in the future' using errcode = '22023';
  end if;

  perform public.coordination_validate_options(p_options, p_default_outcome);

  insert into public.coordination_requests(
    group_id, subgroup_id, created_by, subject, subject_kind,
    options, deadline, policy, default_outcome, status
  ) values (
    p_group_id,
    p_subgroup_id,
    (select auth.uid()),
    btrim(p_subject),
    p_subject_kind,
    p_options,
    p_deadline,
    p_policy,
    p_default_outcome,
    'open'
  )
  returning * into v_request;

  return v_request;
end;
$$;

create or replace function public.respond_to_coordination_request(
  p_request_id uuid,
  p_option_id text
)
returns public.coordination_responses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.coordination_requests;
  v_response public.coordination_responses;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_request
  from public.coordination_requests r
  where r.id = p_request_id
  for update;
  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;

  if v_request.status <> 'open' then
    raise exception 'request already closed' using errcode = '23514';
  end if;

  if v_request.deadline <= now() then
    -- Close first so callers observe a resolved outcome, then reject.
    perform public.resolve_coordination_request_deadline(p_request_id);
    raise exception 'request already closed' using errcode = '23514';
  end if;

  -- Eligible participants only (subgroup scope + leaders; main = all members).
  if not public.coordination_user_eligible(
    v_request.group_id,
    v_request.subgroup_id,
    (select auth.uid())
  ) then
    raise exception 'not eligible for this request' using errcode = '42501';
  end if;

  if nullif(btrim(p_option_id), '') is null
     or not (p_option_id = any(public.coordination_option_ids(v_request.options))) then
    raise exception 'invalid option' using errcode = '22023';
  end if;

  insert into public.coordination_responses(request_id, user_id, option_id)
  values (p_request_id, (select auth.uid()), p_option_id)
  on conflict (request_id, user_id) do update
    set option_id = excluded.option_id,
        updated_at = now()
  returning * into v_response;

  return v_response;
end;
$$;

-- Any group leader may force-close any open request (any policy) with a chosen
-- option. Policy field still governs deadline auto-resolution when no override.
create or replace function public.override_coordination_request(
  p_request_id uuid,
  p_option_id text
)
returns public.coordination_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.coordination_requests;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_request
  from public.coordination_requests r
  where r.id = p_request_id
  for update;
  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;

  if v_request.status <> 'open' then
    return v_request;
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.group_id = v_request.group_id
      and m.user_id = (select auth.uid())
      and m.role = 'leader'
  ) then
    raise exception 'leader membership required' using errcode = '42501';
  end if;

  return public.coordination_close_request(
    p_request_id,
    p_option_id,
    'organizer_override',
    (select auth.uid()),
    'resolved'
  );
end;
$$;

create or replace function public.resolve_coordination_request_deadline(
  p_request_id uuid
)
returns public.coordination_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.coordination_requests;
  v_user_ids uuid[];
  v_option_ids text[];
  v_eligible uuid[];
  v_outcome jsonb;
begin
  select * into v_request
  from public.coordination_requests r
  where r.id = p_request_id
  for update;
  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;

  -- Repeated triggers: one authoritative closed outcome.
  if v_request.status <> 'open' then
    return v_request;
  end if;

  if v_request.deadline > now() then
    raise exception 'deadline not reached' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.group_id = v_request.group_id
      and m.user_id = (select auth.uid())
  ) and (select auth.uid()) is not null then
    raise exception 'active membership required' using errcode = '42501';
  end if;

  select coalesce(array_agg(m.user_id), array[]::uuid[])
  into v_eligible
  from public.memberships m
  where m.group_id = v_request.group_id
    and (
      v_request.subgroup_id is null
      or m.subgroup_id is not distinct from v_request.subgroup_id
      or m.role = 'leader'
    );

  -- Defense-in-depth: only count responses from eligible participants.
  select
    coalesce(array_agg(cr.user_id order by cr.responded_at), array[]::uuid[]),
    coalesce(array_agg(cr.option_id order by cr.responded_at), array[]::text[])
  into v_user_ids, v_option_ids
  from public.coordination_responses cr
  where cr.request_id = p_request_id
    and cr.user_id = any(v_eligible);

  v_outcome := public.coordination_compute_outcome(
    v_request.policy,
    v_request.default_outcome,
    v_eligible,
    v_user_ids,
    v_option_ids
  );

  return public.coordination_close_request(
    p_request_id,
    v_outcome->>'option_id',
    v_outcome->>'source',
    coalesce((select auth.uid()), v_request.created_by),
    case
      when v_outcome->>'source' = 'timeout_default' then 'expired'
      else 'resolved'
    end
  );
end;
$$;

create or replace function public.resolve_due_coordination_requests(
  p_group_id uuid
)
returns setof public.coordination_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not extensions.is_member(p_group_id) then
    raise exception 'active membership required' using errcode = '42501';
  end if;

  for v_id in
    select r.id
    from public.coordination_requests r
    where r.group_id = p_group_id
      and r.status = 'open'
      and r.deadline <= now()
    order by r.deadline asc
  loop
    return next public.resolve_coordination_request_deadline(v_id);
  end loop;

  return;
end;
$$;

-- Cancel aborts without applying itinerary and without a decided option.
-- resolved_outcome stays null so clients never treat cancel as a timeout win.
create or replace function public.cancel_coordination_request(
  p_request_id uuid
)
returns public.coordination_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.coordination_requests;
  v_closed public.coordination_requests;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_request
  from public.coordination_requests r
  where r.id = p_request_id
  for update;
  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;

  if v_request.status <> 'open' then
    return v_request;
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.group_id = v_request.group_id
      and m.user_id = (select auth.uid())
      and m.role = 'leader'
  ) then
    raise exception 'leader membership required' using errcode = '42501';
  end if;

  update public.coordination_requests
  set status = 'cancelled',
      resolved_outcome = null,
      resolution_source = 'cancelled',
      resolved_at = now(),
      resolved_by = (select auth.uid()),
      applied_operation_id = null,
      updated_at = now()
  where id = p_request_id
    and status = 'open'
  returning * into v_closed;

  if not found then
    select * into v_closed from public.coordination_requests where id = p_request_id;
  end if;

  return v_closed;
end;
$$;

revoke all on function public.coordination_user_eligible(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.coordination_option_ids(jsonb) from public, anon, authenticated;
revoke all on function public.coordination_validate_options(jsonb, text) from public, anon, authenticated;
revoke all on function public.coordination_compute_outcome(text, text, uuid[], uuid[], text[])
  from public, anon, authenticated;
revoke all on function public.coordination_apply_outcome(public.coordination_requests, text, uuid)
  from public, anon, authenticated;
revoke all on function public.coordination_close_request(uuid, text, text, uuid, text)
  from public, anon, authenticated;

revoke all on function public.create_coordination_request(
  uuid, uuid, text, text, jsonb, timestamptz, text, text
) from public, anon;
grant execute on function public.create_coordination_request(
  uuid, uuid, text, text, jsonb, timestamptz, text, text
) to authenticated;

revoke all on function public.respond_to_coordination_request(uuid, text) from public, anon;
grant execute on function public.respond_to_coordination_request(uuid, text) to authenticated;

revoke all on function public.override_coordination_request(uuid, text) from public, anon;
grant execute on function public.override_coordination_request(uuid, text) to authenticated;

revoke all on function public.resolve_coordination_request_deadline(uuid) from public, anon;
grant execute on function public.resolve_coordination_request_deadline(uuid) to authenticated;

revoke all on function public.resolve_due_coordination_requests(uuid) from public, anon;
grant execute on function public.resolve_due_coordination_requests(uuid) to authenticated;

revoke all on function public.cancel_coordination_request(uuid) from public, anon;
grant execute on function public.cancel_coordination_request(uuid) to authenticated;

-- Explicitly: start_navigation_session is independent of coordination requests.
-- No coordination guard is added to navigation session RPCs.
