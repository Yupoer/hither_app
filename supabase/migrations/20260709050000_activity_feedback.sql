-- Self-hosted analytics + feedback (no third-party tooling by design).

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);
alter table public.activity_logs enable row level security;
create policy "activity_logs: insert own" on public.activity_logs
  for insert to authenticated with check (user_id = (select auth.uid()));
create index idx_activity_logs_user_created on public.activity_logs(user_id, created_at);
grant insert on public.activity_logs to authenticated;

create table public.feedback_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  context_tag text not null,
  description text not null,
  screenshot_path text,
  device jsonb,
  created_at timestamptz not null default now()
);
alter table public.feedback_reports enable row level security;
create policy "feedback_reports: insert own" on public.feedback_reports
  for insert to authenticated with check (user_id = (select auth.uid()));
grant insert on public.feedback_reports to authenticated;

-- Screenshot bucket (private; nobody reads from the client).
insert into storage.buckets (id, name, public) values ('feedback-screenshots', 'feedback-screenshots', false)
  on conflict (id) do nothing;
create policy "feedback screenshots: upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'feedback-screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text);
