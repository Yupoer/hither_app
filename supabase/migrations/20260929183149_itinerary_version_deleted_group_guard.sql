create or replace function public.bump_core_itinerary_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid := coalesce(new.group_id, old.group_id);
begin
  if current_setting('hither.core_operation_v2', true) = v_group_id::text then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  -- Cascading itinerary DELETE runs after its parent group is gone.
  -- Never recreate a version row for that deleted parent.
  perform 1 from public.groups where id = v_group_id for key share;
  if not found then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  insert into public.core_entity_versions(
    group_id, entity_type, entity_id, entity_version, state, updated_at
  ) values (
    v_group_id, 'itinerary', v_group_id::text, 1,
    public.core_itinerary_state(v_group_id), now()
  ) on conflict (group_id, entity_type, entity_id) do update
    set entity_version = public.core_entity_versions.entity_version + 1,
        state = public.core_itinerary_state(v_group_id),
        updated_at = now();
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
