begin;

create or replace function public.on_journey_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if row(new.journey_status, new.active_destination_id, new.journey_started_at)
       is distinct from row(old.journey_status, old.active_destination_id, old.journey_started_at)
    and not (new.journey_status = 'paused' and exists (
      select 1 from public.itinerary_items i where i.id = old.active_destination_id and i.closed_at is not null
    )) then
    perform extensions.notify_push(jsonb_build_object(
      'category', 'journey', 'group_id', new.id, 'sender_id', (select auth.uid()),
      'status', new.journey_status,
      'destination_id', coalesce(new.active_destination_id, old.active_destination_id),
      'version', floor(extract(epoch from coalesce(new.journey_started_at, old.journey_started_at)) * 1000)::bigint
    ));
  end if;
  return new;
end;
$$;
revoke all on function public.on_journey_change() from public, anon, authenticated;

drop trigger if exists trg_journey_change on public.groups;
create trigger trg_journey_change
  after update of journey_status, active_destination_id, journey_started_at on public.groups
  for each row execute function public.on_journey_change();

revoke insert, update, delete on public.group_alerts from public, anon, authenticated;
grant select on public.group_alerts to service_role;

alter table public.group_alerts drop constraint group_alerts_kind_check;
alter table public.group_alerts add constraint group_alerts_kind_check
  check (kind in ('straggler', 'member_solo', 'member_follow', 'member_left'));

create function public.on_membership_participation_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_kind text;
  v_name text;
begin
  if tg_op = 'DELETE' then
    if (select auth.uid()) is distinct from old.user_id then return old; end if;
    if not exists (select 1 from public.groups g where g.id = old.group_id) then
      return old;
    end if;
    v_kind := 'member_left';
  else
    if new.solo is not distinct from old.solo then return new; end if;
    v_kind := case when new.solo then 'member_solo' else 'member_follow' end;
  end if;
  select nullif(trim(p.nickname), '') into v_name from public.profiles p where p.id = old.user_id;
  insert into public.group_alerts(group_id, kind, sender_id, member_id, member_name)
    values (old.group_id, v_kind, old.user_id, old.user_id, coalesce(v_name, ''));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.on_membership_participation_change() from public, anon, authenticated;
create trigger trg_membership_participation_change
  after update of solo or delete on public.memberships
  for each row execute function public.on_membership_participation_change();

commit;
