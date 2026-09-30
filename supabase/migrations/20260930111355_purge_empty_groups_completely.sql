-- No members means the group and all group-owned records can be removed.
begin;
set local lock_timeout = '5s';
-- Keep membership additions/removals from racing the one-time empty scan.
lock table public.memberships in share row exclusive mode;

alter table public.token_ledger
  drop constraint token_ledger_group_id_fkey,
  add constraint token_ledger_group_id_fkey
    foreign key (group_id) references public.groups(id) on delete cascade;
alter table public.promo_redemptions
  drop constraint promo_redemptions_group_id_fkey,
  add constraint promo_redemptions_group_id_fkey
    foreign key (group_id) references public.groups(id) on delete cascade;

-- Existing group FKs cascade through history, destinations, positions, scopes
-- and queued operations. The two FKs above now follow the same lifecycle.
delete from public.groups g
where not exists (select 1 from public.memberships m where m.group_id = g.id);
commit;
