import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(__dirname, '../../../../supabase/migrations/20260812010000_kick_group_member.sql'),
  'utf8',
).replace(/\r\n/g, '\n');
const service = readFileSync(join(__dirname, '../api/services/GroupService.ts'), 'utf8');
const client = readFileSync(join(__dirname, '../api/client.ts'), 'utf8');
const mapScreen = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');

describe('kick_group_member (#168)', () => {
  it('defines leader-only SECURITY DEFINER RPC with fixed search_path', () => {
    expect(migration).toContain('create or replace function public.kick_group_member(p_group_id uuid, p_user_id uuid)');
    expect(migration).toContain('security definer');
    expect(migration).toContain("set search_path = ''");
    // Expiry-aware gate before raw memberships role check (#166 Sol P1).
    expect(migration).toContain('extensions.is_member(p_group_id)');
    expect(migration.indexOf('extensions.is_member(p_group_id)')).toBeLessThan(
      migration.indexOf("m.role = 'leader'"),
    );
    expect(migration).toContain("m.role = 'leader'");
    expect(migration).toContain('cannot kick self');
    expect(migration).toContain('cannot kick leader');
    expect(migration).toContain('delete from public.memberships');
    expect(migration).toContain('set invite_code = v_code');
    expect(migration).toContain(
      'grant execute on function public.kick_group_member(uuid, uuid) to authenticated',
    );
    expect(migration).toContain(
      'revoke all on function public.kick_group_member(uuid, uuid) from public, anon',
    );
  });

  it('wires client RPC and leader kick surface', () => {
    expect(service).toContain("supabase.rpc('kick_group_member'");
    expect(service).toContain('export async function kickGroupMember');
    expect(client).toContain('kickGroupMember');
    expect(mapScreen).toContain('kickGroupMember');
    expect(mapScreen).toContain('onKick');
  });
});
