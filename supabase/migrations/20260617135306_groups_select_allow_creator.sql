-- Fix: a group's creator must be able to SELECT the group they just inserted,
-- before their leader membership row exists. Without this, createGroup's
-- insert().select() returns no representation and PostgREST raises a 42501,
-- and there is no way to read back the new group id to create the membership
-- (chicken-and-egg). Allow select when the caller is a member OR the creator.
drop policy if exists "groups: select if member" on public.groups;
create policy "groups: select if member or creator" on public.groups
  for select to authenticated
  using (extensions.is_member(id) or created_by = (select auth.uid()));
