-- Straggler alerts: leader-tunable distance threshold for "someone fell behind".
alter table public.groups
  add column straggler_alerts boolean not null default true,
  add column straggler_threshold_m integer not null default 500;
