-- Meet-time date/time APNs:
-- 1) When a leader sets/changes meet_at → immediate push (meet_time_set)
-- 2) When remaining time first enters meet_red_minutes → warning push
-- 3) When meet_at arrives → due push
-- Shared meet_red_minutes so the countdown red threshold is captain-driven
-- for the whole flock (not a per-device AsyncStorage preference alone).

alter table public.itinerary_items
  add column if not exists meet_red_minutes integer not null default 5
    check (meet_red_minutes in (3, 5, 10));

alter table public.itinerary_items
  add column if not exists meet_set_by uuid references auth.users (id) on delete set null;

alter table public.itinerary_items
  add column if not exists meet_warn_pushed_at timestamptz;

alter table public.itinerary_items
  add column if not exists meet_due_pushed_at timestamptz;

comment on column public.itinerary_items.meet_red_minutes is
  'Minutes remaining at which countdown turns red and a meet_warning APNs fires.';
comment on column public.itinerary_items.meet_set_by is
  'User who last set meet_at (used as push sender for scheduled meet pushes).';

-- Immediate APNs when meet_at is set/changed/cleared.
create or replace function public.on_itinerary_meet_at_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender uuid;
begin
  if new.meet_at is not distinct from old.meet_at
     and new.meet_red_minutes is not distinct from old.meet_red_minutes then
    return new;
  end if;

  -- Reset scheduled-push flags whenever the target time or red threshold changes.
  if new.meet_at is distinct from old.meet_at
     or new.meet_red_minutes is distinct from old.meet_red_minutes then
    new.meet_warn_pushed_at := null;
    new.meet_due_pushed_at := null;
  end if;

  -- Only announce set/clear when the absolute meet clock changes.
  if new.meet_at is distinct from old.meet_at then
    v_sender := coalesce(auth.uid(), new.meet_set_by, new.created_by);
    if new.meet_at is not null then
      new.meet_set_by := coalesce(auth.uid(), new.meet_set_by);
      if v_sender is not null then
        perform extensions.notify_push(jsonb_build_object(
          'category', 'meet_time_set',
          'group_id', new.group_id,
          'sender_id', v_sender,
          'destination_id', new.id,
          'title', new.title,
          'meet_at', new.meet_at,
          'minutes', new.meet_red_minutes
        ));
      end if;
    elsif old.meet_at is not null and v_sender is not null then
      perform extensions.notify_push(jsonb_build_object(
        'category', 'meet_time_cleared',
        'group_id', new.group_id,
        'sender_id', v_sender,
        'destination_id', new.id,
        'title', new.title
      ));
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_itinerary_meet_at_change on public.itinerary_items;
create trigger trg_itinerary_meet_at_change
  before update of meet_at, meet_red_minutes on public.itinerary_items
  for each row execute function public.on_itinerary_meet_at_change();

-- Scan due meet times and fan out warning / due APNs.
-- Designed to be invoked by pg_cron every minute (or manually / via Edge cron).
create or replace function public.process_meet_time_pushes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_sender uuid;
  v_pushed integer := 0;
  v_minutes_left integer;
begin
  -- Warning: first moment remaining time is within meet_red_minutes (and still before meet_at).
  for r in
    select i.id, i.group_id, i.title, i.meet_at, i.meet_red_minutes, i.meet_set_by, i.created_by, g.created_by as group_leader
    from public.itinerary_items i
    join public.groups g on g.id = i.group_id
    where i.meet_at is not null
      and i.meet_warn_pushed_at is null
      and i.meet_at > now()
      and now() >= i.meet_at - make_interval(mins => i.meet_red_minutes)
  loop
    v_sender := coalesce(r.meet_set_by, r.created_by, r.group_leader);
    if v_sender is null then
      continue;
    end if;
    v_minutes_left := greatest(
      0,
      ceil(extract(epoch from (r.meet_at - now())) / 60.0)::integer
    );
    perform extensions.notify_push(jsonb_build_object(
      'category', 'meet_warning',
      'group_id', r.group_id,
      'sender_id', v_sender,
      'destination_id', r.id,
      'title', r.title,
      'meet_at', r.meet_at,
      'minutes', v_minutes_left
    ));
    update public.itinerary_items
      set meet_warn_pushed_at = now()
      where id = r.id;
    v_pushed := v_pushed + 1;
  end loop;

  -- Due: meet_at has arrived.
  for r in
    select i.id, i.group_id, i.title, i.meet_at, i.meet_set_by, i.created_by, g.created_by as group_leader
    from public.itinerary_items i
    join public.groups g on g.id = i.group_id
    where i.meet_at is not null
      and i.meet_due_pushed_at is null
      and i.meet_at <= now()
      -- Only notify for recent due windows (avoid blasting old stops on first deploy).
      and i.meet_at > now() - interval '2 hours'
  loop
    v_sender := coalesce(r.meet_set_by, r.created_by, r.group_leader);
    if v_sender is null then
      continue;
    end if;
    perform extensions.notify_push(jsonb_build_object(
      'category', 'meet_due',
      'group_id', r.group_id,
      'sender_id', v_sender,
      'destination_id', r.id,
      'title', r.title,
      'meet_at', r.meet_at
    ));
    update public.itinerary_items
      set meet_due_pushed_at = now()
      where id = r.id;
    v_pushed := v_pushed + 1;
  end loop;

  return v_pushed;
end;
$$;

revoke all on function public.process_meet_time_pushes() from public, anon, authenticated;
grant execute on function public.process_meet_time_pushes() to service_role;

revoke all on function public.on_itinerary_meet_at_change() from public, anon, authenticated;

-- Schedule every minute when pg_cron is available (Supabase Pro / local with extension).
do $$
begin
  create extension if not exists pg_cron with schema extensions;
exception
  when others then
    raise notice 'pg_cron unavailable; schedule public.process_meet_time_pushes() externally';
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'hither-meet-time-pushes';

    perform cron.schedule(
      'hither-meet-time-pushes',
      '* * * * *',
      $cron$ select public.process_meet_time_pushes(); $cron$
    );
  end if;
exception
  when others then
    raise notice 'Could not schedule meet-time cron: %', sqlerrm;
end;
$$;
