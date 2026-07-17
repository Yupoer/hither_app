import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(__dirname, '../../../../supabase/migrations/20260717140000_performance_tracing.sql'),
  'utf8',
).toLowerCase();

describe('performance tracing contract', () => {
  it('stores bounded raw events and protects them with user-owned RLS', () => {
    expect(migration).toContain('create table public.performance_events');
    expect(migration).toContain('octet_length(payload::text) <= 32768');
    expect(migration).toContain('alter table public.performance_events enable row level security');
    expect(migration).toContain('performance_events: own insert');
    expect(migration).toContain('grant select, insert on public.performance_events to authenticated');
  });

  it('keeps rollups server-only and schedules daily aggregation', () => {
    expect(migration).toContain('create table public.performance_daily_rollups');
    expect(migration).toContain('alter table public.performance_daily_rollups enable row level security');
    expect(migration).toContain('revoke all on public.performance_daily_rollups from anon, authenticated');
    expect(migration).toContain('create or replace function public.rollup_performance_day');
    expect(migration).toContain("'hither_performance_rollup'");
    expect(migration).toContain("'select public.rollup_performance_day(current_date - 1)'");
  });

  it('does not silently delete existing production records during schema rollout', () => {
    expect(migration).not.toMatch(/delete\s+from\s+public\./);
    expect(migration).not.toContain('cron.job_run_details');
  });
});
