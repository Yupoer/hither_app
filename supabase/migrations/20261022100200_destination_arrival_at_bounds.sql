-- set_destination_arrival_at wrote any client-supplied p_arrived_at. Clients
-- send device-now (possibly from the offline outbox), so bound it: allow a
-- small clock skew into the future but store at most now(), and reject
-- values far in the future or older than any plausible offline replay.
-- NULL still means server-side now().

create or replace function public.set_destination_arrival_at(
  p_destination_id uuid,
  p_target_user_id uuid,
  p_arrived boolean,
  p_arrived_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_arrived_at timestamptz;
begin
  if p_arrived and p_arrived_at is not null then
    if p_arrived_at > now() + interval '5 minutes' then
      raise exception 'arrived_at is in the future' using errcode = '22023';
    end if;
    if p_arrived_at < now() - interval '30 days' then
      raise exception 'arrived_at is too old' using errcode = '22023';
    end if;
    v_arrived_at := least(p_arrived_at, now());
  end if;

  perform public.set_destination_arrival(
    p_destination_id, p_target_user_id, p_arrived
  );

  if v_arrived_at is not null then
    update public.destination_arrivals
    set arrived_at = v_arrived_at
    where destination_id = p_destination_id
      and user_id = p_target_user_id;
    update public.visited_waypoints
    set arrived_at = v_arrived_at
    where arrival_id = (
      select a.id
      from public.destination_arrivals a
      where a.destination_id = p_destination_id
        and a.user_id = p_target_user_id
    );
  end if;
end;
$$;

revoke all on function public.set_destination_arrival_at(uuid, uuid, boolean, timestamptz)
  from public, anon;
grant execute on function public.set_destination_arrival_at(uuid, uuid, boolean, timestamptz)
  to authenticated;
