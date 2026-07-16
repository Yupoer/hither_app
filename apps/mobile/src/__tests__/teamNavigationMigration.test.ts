import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(
    __dirname,
    '../../../../supabase/migrations/20260716214247_team_navigation_sessions.sql',
  ),
  'utf8',
).toLowerCase();

describe('team navigation session migration', () => {
  it.each([
    'member_privacy_settings',
    'navigation_sessions',
    'navigation_member_states',
    'device_live_activity_tokens',
    'location_upload_events',
    'diagnostic_sessions',
    'diagnostic_events',
    'metric_payloads',
  ])('creates %s with row-level security', (table) => {
    expect(migration).toContain(`create table public.${table}`);
    expect(migration).toContain(
      `alter table public.${table} enable row level security`,
    );
  });

  it('enforces one active session and idempotent request ids', () => {
    expect(migration).toContain('unique (group_id, request_id)');
    expect(migration).toMatch(
      /create unique index navigation_sessions_one_active_group[\s\S]*where status = 'active'/,
    );
  });

  it.each([
    'start_navigation_session',
    'cancel_navigation_session',
    'complete_navigation_session',
    'ack_navigation_session',
    'ingest_location_batch',
    'ingest_diagnostic_batch',
  ])('creates and grants the %s RPC', (rpc) => {
    expect(migration).toContain(`create or replace function public.${rpc}`);
    expect(migration).toContain(`grant execute on function public.${rpc}`);
  });

  it('publishes session/member state and emits navigation push events', () => {
    expect(migration).toContain(
      'alter publication supabase_realtime add table public.navigation_sessions',
    );
    expect(migration).toContain(
      'alter publication supabase_realtime add table public.navigation_member_states',
    );
    expect(migration).toContain("'navigation_session'");
    expect(migration).toContain('extensions.notify_push');
  });

  it('rejects location ingestion when sharing is disabled', () => {
    expect(migration).toContain('member_privacy_settings');
    expect(migration).toContain('sharing_enabled');
    expect(migration).toContain("'sharing_disabled'");
  });

  it('stores the full latest-location envelope and removes one-fix arrival', () => {
    expect(migration).toContain(
      'alter table public.member_locations add column if not exists horizontal_accuracy',
    );
    expect(migration).toContain(
      'drop trigger if exists trg_member_location_arrival on public.member_locations',
    );
    expect(migration).not.toContain('v_distance_m <= 30');
  });
});
