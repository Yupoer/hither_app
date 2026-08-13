import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(__dirname, '../../../../supabase/migrations/20260813100000_location_refresh_pending.sql'),
  'utf8',
);
const service = readFileSync(
  join(__dirname, '../api/services/LocationService.ts'),
  'utf8',
);
const refresh = readFileSync(
  join(__dirname, '../state/backgroundLocationRefresh.ts'),
  'utf8',
);
const controller = readFileSync(
  join(__dirname, '../state/backgroundJourneyController.ts'),
  'utf8',
);
const mapScreen = readFileSync(
  join(__dirname, '../screens/MapScreen.tsx'),
  'utf8',
);

describe('durable location refresh contract (#191)', () => {
  it('keeps a per-recipient versioned ledger behind explicit RPCs', () => {
    expect(migration).toMatch(/create table if not exists public\.location_refresh_pending/);
    expect(migration).toContain('primary key (group_id, user_id)');
    expect(migration).toContain('alter table public.location_refresh_pending enable row level security');
    expect(migration).toContain('revoke all on table public.location_refresh_pending');
    expect(migration).toContain('create or replace function public.list_my_pending_location_refreshes()');
    expect(migration).toContain('create or replace function public.ack_my_location_refresh(');
    expect(migration).toMatch(/security definer[\s\S]*set search_path = ''/g);
    expect(migration).toContain('and public.anonymous_access_is_active(m.user_id)');
    expect(migration).toContain('and requested_at = p_requested_at');
    expect(migration).toContain('and extensions.is_member(p_group_id)');
  });

  it('uploads one fix for all pending groups and ACKs only accepted request versions', () => {
    expect(service).toContain("rpc('list_my_pending_location_refreshes')");
    expect(service).toContain("rpc('ack_my_location_refresh'");
    expect(refresh).toContain('const events = pending.map');
    expect(refresh).toContain('const accepted = new Set(result.acceptedIds)');
    expect(refresh).toContain('if (!accepted.has(events[index].id)) continue');
    expect(refresh).toContain('ackMyLocationRefresh(row.groupId, row.requestedAt)');
    expect(refresh).toContain('getCurrentLocation(false)');
    expect(refresh).toContain('foreground_upload_failed');
  });

  it('prepares permissions while active and never prompts from a flagged background transition', () => {
    expect(controller).toContain('permissionsPrepared?: boolean');
    expect(controller).toContain('config.permissionsPrepared === false && config.appState != null');
    expect(mapScreen).toContain('prepareBackgroundJourneyPermissions');
    expect(mapScreen).toContain('permissionsPrepared: backgroundPermissionsPreparedFor === groupId');
    expect(controller).toContain("pausesUpdatesAutomatically: mode !== 'passiveBackground'");
  });
});
