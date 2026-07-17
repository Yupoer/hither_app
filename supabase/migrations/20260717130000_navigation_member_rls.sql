-- Follow-up hardening for the already-deployed shared-progress migration:
-- keep leader authorization visible to the invoker while allowing the atomic
-- transition to mark other members missed.

drop policy if exists "navigation_member_states: leaders update" on public.navigation_member_states;
create policy "navigation_member_states: leaders update"
  on public.navigation_member_states for update to authenticated
  using (exists (
    select 1
    from public.navigation_sessions s
    join public.memberships m on m.group_id = s.group_id
    where s.id = navigation_member_states.navigation_session_id
      and m.user_id = (select auth.uid())
      and m.role = 'leader'
  ))
  with check (exists (
    select 1
    from public.navigation_sessions s
    join public.memberships m on m.group_id = s.group_id
    where s.id = navigation_member_states.navigation_session_id
      and m.user_id = (select auth.uid())
      and m.role = 'leader'
  ));

alter function public.start_navigation_session(uuid, uuid, uuid)
  security invoker;
alter function public.complete_navigation_session(uuid, integer)
  security invoker;
