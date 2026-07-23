import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(__dirname, '../../../../supabase/migrations/20260717050721_performance_tracing.sql'),
  'utf8',
).toLowerCase();

const service = readFileSync(
  join(__dirname, '../api/services/PerformanceService.ts'),
  'utf8',
);
const performance = readFileSync(
  join(__dirname, '../state/performance.ts'),
  'utf8',
);

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

  it('acknowledges duplicate performance ids without a 409 retry loop', () => {
    expect(service).toContain('.upsert(');
    expect(service).toContain("onConflict: 'id'");
    expect(service).toContain('ignoreDuplicates: true');
  });

  it('keeps full tracing short and samples successful API spans without eager flush timers', () => {
    expect(performance).toContain('TRACE_TTL_MS = 2 * 60 * 60 * 1_000');
    expect(performance).toContain('SUCCESS_TRACE_MIN_INTERVAL_MS = 10_000');
    expect(performance).toContain('SAMPLE_WINDOW_MS = 1_000');
    expect(performance).toContain('SAMPLE_INTERVAL_MS = 5 * 60_000');
    expect(performance).not.toContain('FLUSH_DELAY_MS');
    expect(performance).toContain('getDiagnosticConsentEnabled');
    expect(performance).toContain('notifyLogRecorded');
    expect(performance).toContain('purgePerformance');
  });

  it('separates permanent error queue from two-hour full tracing', () => {
    expect(performance).toContain('export async function recordErrorEvent');
    expect(performance).toContain('notifyErrorRecorded');
    expect(performance).toContain("CASE event_type WHEN 'error' THEN 0 ELSE 1 END");
    expect(performance).toContain('exceptionKind');
    expect(performance).toContain('stackHash');
    expect(performance).toContain('updateId');
    expect(performance).toContain('runtimeVersion');
    expect(performance).toContain('launchPhase');
    expect(performance).toContain('lastScreen');
    // Must not gate errors solely on active full-trace flag in recordPerformanceError.
    expect(performance).toMatch(
      /recordPerformanceError[\s\S]*?await recordErrorEvent/,
    );
  });

  it('exposes a navigation-only energy monitor independent of full API tracing', () => {
    expect(performance).toContain('export function startNavigationEnergyMonitor');
    expect(performance).toContain('navigation.energy.sample');
    expect(performance).toContain('navigation.energy.end');
    expect(performance).toContain('navigationSessionId');
    expect(performance).toContain('trackingMode');
  });

  it('derives CPU percent from cpuTimeMs deltas and gates samples on app state', () => {
    expect(performance).toContain('export function deriveCpuPercent');
    expect(performance).toContain('export function setPerformanceAppState');
    expect(performance).toContain('isAppForeground');
    expect(performance).toContain('memoryDeltaMb');
    // Must not import react-native (Jest node suite).
    expect(performance).not.toMatch(/from 'react-native'/);
  });
});
