import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(
    __dirname,
    '../../../../supabase/migrations/20260717180000_delete_destination_nav_fk.sql',
  ),
  'utf8',
).toLowerCase();

describe('delete destination navigation fk migration', () => {
  it('makes destination_id nullable and sets on delete set null', () => {
    expect(migration).toContain('alter column destination_id drop not null');
    expect(migration).toContain('drop constraint navigation_sessions_destination_id_fkey');
    expect(migration).toContain('on delete set null');
  });

  it('creates and grants delete_destination rpc', () => {
    expect(migration).toContain(
      'create or replace function public.delete_destination',
    );
    expect(migration).toContain(
      'grant execute on function public.delete_destination(uuid, uuid) to authenticated',
    );
    expect(migration).toContain("m.role = 'leader'");
    expect(migration).toContain("status = 'cancelled'");
  });
});
