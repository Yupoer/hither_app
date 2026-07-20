-- Constrain push_tokens.platform to ios | android for APNs / FCM fan-out.
-- Existing rows keep default 'ios'.

alter table public.push_tokens
  drop constraint if exists push_tokens_platform_check;

alter table public.push_tokens
  add constraint push_tokens_platform_check
  check (platform in ('ios', 'android'));

comment on column public.push_tokens.platform is
  'Push provider platform: ios (APNs) or android (FCM).';
