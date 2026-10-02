-- Installation-scoped capabilities. Legacy rows stay readable until this device
-- claims them on registration; logout also matches its native token/activity IDs.
alter table public.push_tokens add column device_id text;
alter table public.live_activity_sessions add column device_id text;

-- Unbound historical push capabilities cannot prove which installation owns
-- them. Revoke and let the upgraded app register; do not guess account ownership.
delete from public.push_tokens where device_id is null;
create unique index push_tokens_single_delivery_owner on public.push_tokens(token);

create table public.revoked_installation_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  session_id uuid not null,
  primary key (user_id, device_id, session_id)
);
alter table public.revoked_installation_sessions enable row level security;
revoke all on public.revoked_installation_sessions from public, anon, authenticated;

-- Both registration and revoke take the same transaction lock. Even a request
-- already in flight cannot recreate a capability after revocation commits.
create function public.guard_installation_capability() returns trigger
language plpgsql security definer set search_path = '' as $$
declare sid uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
begin
  if auth.uid() is null then return new; end if; -- trusted service-role maintenance
  if new.user_id is distinct from auth.uid() or new.device_id is null or sid is null then
    raise exception 'Authenticated installation binding required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || '/' || new.device_id || '/' || sid::text, 0));
  if exists(select 1 from public.revoked_installation_sessions
    where user_id = new.user_id and device_id = new.device_id and session_id = sid) then
    raise exception 'Installation session was revoked; sign in again' using errcode = '42501';
  end if;
  if tg_table_name = 'push_tokens' then
    perform pg_advisory_xact_lock(hashtextextended('push-token/' || new.token, 0));
    -- Only the same installation can rebind a delivery token after switching
    -- accounts. A different device's ownership is protected by the unique index.
    delete from public.push_tokens where token = new.token
      and device_id = new.device_id and user_id <> new.user_id;
  elsif tg_table_name = 'device_live_activity_tokens' then
    if new.push_to_start_token is not null then
      perform pg_advisory_xact_lock(hashtextextended('activity-start/' || new.push_to_start_token, 0));
      delete from public.device_live_activity_tokens where push_to_start_token = new.push_to_start_token
        and device_id = new.device_id and user_id <> new.user_id;
    end if;
  elsif tg_table_name = 'live_activity_sessions' then
    if new.push_token is not null then
      perform pg_advisory_xact_lock(hashtextextended('activity-token/' || new.push_token, 0));
      delete from public.live_activity_sessions where push_token = new.push_token
        and device_id = new.device_id and user_id <> new.user_id;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_installation_capability() from public, anon, authenticated;
create trigger guard_installation_push before insert or update on public.push_tokens
  for each row execute function public.guard_installation_capability();
create trigger guard_installation_live_session before insert or update on public.live_activity_sessions
  for each row execute function public.guard_installation_capability();
create trigger guard_installation_live_token before insert or update on public.device_live_activity_tokens
  for each row execute function public.guard_installation_capability();

create function public.revoke_installation_capabilities(p_device_id text, p_push_token text default null, p_activity_ids text[] default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); sid uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
begin
  if uid is null or sid is null or length(p_device_id) not between 8 and 200
    or p_device_id is null or cardinality(p_activity_ids) > 100 then
    raise exception 'Authenticated installation required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text || '/' || p_device_id || '/' || sid::text, 0));
  insert into public.revoked_installation_sessions values(uid, p_device_id, sid) on conflict do nothing;
  delete from public.push_tokens where user_id = uid and
    (device_id = p_device_id or (device_id is null and token = p_push_token));
  delete from public.device_live_activity_tokens where user_id = uid and device_id = p_device_id;
  delete from public.live_activity_sessions where user_id = uid and
    (device_id = p_device_id or (device_id is null and activity_id = any(p_activity_ids)));
end $$;
revoke all on function public.revoke_installation_capabilities(text,text,text[]) from public, anon;
grant execute on function public.revoke_installation_capabilities(text,text,text[]) to authenticated;
