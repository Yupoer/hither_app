-- Hardening for leader gather-point approval:
-- 1) notify_push must never abort itinerary writes (approve inserts fire the insert trigger).
-- 2) resolve_gather_point_request returns jsonb so clients get a real body (not void/204).

create or replace function extensions.notify_push(payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select ds.decrypted_secret
  into v_url
  from vault.decrypted_secrets ds
  where ds.name = 'push_edge_url'
  order by ds.created_at desc
  limit 1;

  select ds.decrypted_secret
  into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'push_webhook_secret'
  order by ds.created_at desc
  limit 1;

  if v_url is null or v_url = '' or v_secret is null or v_secret = '' then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hither-webhook-secret', v_secret
    ),
    body := payload
  );
exception
  when others then
    -- Push is best-effort. Never roll back the business write that triggered it.
    null;
end;
$$;

revoke all on function extensions.notify_push(jsonb)
  from public, anon, authenticated;

-- Return type change requires drop + recreate.
drop function if exists public.resolve_gather_point_request(uuid, boolean);

create function public.resolve_gather_point_request(
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
  select * into v_request
  from public.gather_point_requests r
  where r.id = p_request_id
  for update;
  if not found then raise exception 'request not found' using errcode = 'P0002'; end if;
  if v_request.status <> 'pending' then
    raise exception 'request already resolved' using errcode = '23505';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.group_id = v_request.group_id
      and m.user_id = (select auth.uid())
      and m.role = 'leader'
  ) then
    raise exception 'leader membership required' using errcode = '42501';
  end if;

  if p_approve then
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
        v_request.group_id,
        v_request.subgroup_id,
        btrim(v_item->>'title'),
        nullif(v_item->>'address', ''),
        greatest(1, coalesce((v_item->>'day')::integer, 1)),
        (v_item->>'latitude')::double precision,
        (v_item->>'longitude')::double precision,
        v_position,
        (select auth.uid())
      );
      v_inserted := v_inserted + 1;
    end loop;
  end if;

  update public.gather_point_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where id = p_request_id;

  return jsonb_build_object(
    'status', case when p_approve then 'approved' else 'rejected' end,
    'inserted_count', v_inserted
  );
end;
$$;

revoke all on function public.resolve_gather_point_request(uuid, boolean) from public, anon;
grant execute on function public.resolve_gather_point_request(uuid, boolean) to authenticated;
