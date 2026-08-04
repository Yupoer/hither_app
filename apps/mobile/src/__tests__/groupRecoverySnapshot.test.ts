import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(__dirname, '../../../../supabase/migrations/20260804010000_group_recovery_snapshot.sql'),
  'utf8',
).replace(/\r\n/g, '\n');
const hook = readFileSync(join(__dirname, '../state/useGroupState.ts'), 'utf8');
const service = readFileSync(join(__dirname, '../api/services/GroupService.ts'), 'utf8');

describe('Ticket 2 single recovery snapshot contract', () => {
  it('returns all state families in one RPC with member authorization', () => {
    for (const key of [
      "'group'",
      "'memberships'",
      "'profiles'",
      "'subgroups'",
      "'itinerary'",
      "'locations'",
      "'entity_versions'",
      "'realtime_revision'",
    ]) {
      expect(migration).toContain(key);
    }
    expect(migration).toContain('not_member');
    expect(migration).toContain('extensions.is_member(p_group_id)');
    expect(migration).not.toMatch(
      /select exists\(\s*select 1 from public\.memberships m/i,
    );
    expect(migration).toContain('grant execute on function public.get_group_recovery_snapshot(uuid) to authenticated');
  });

  it('uses the single RPC and guards stale responses with revisions', () => {
    expect(service).toContain("supabase.rpc('get_group_recovery_snapshot'");
    expect(hook).toContain('latestRevisionRef');
    expect(hook).toContain('isOlderRevision');
    expect(hook).not.toContain('getGroupState(groupId)');
    expect(hook).toContain('GROUP_POLL_INTERVAL_MS = 60_000');
  });
});
