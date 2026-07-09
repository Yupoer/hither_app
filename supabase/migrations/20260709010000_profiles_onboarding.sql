-- Onboarding answers captured before sign-in, synced to the profile once a session exists.
alter table public.profiles add column onboarding jsonb;
