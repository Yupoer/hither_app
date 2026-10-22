-- core_operations.actor_id references auth.users on delete cascade. Without an
-- index on actor_id, every account deletion scans the whole operation log.
create index if not exists core_operations_actor_id_idx
  on public.core_operations(actor_id);
