import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const authFlow = readFileSync(join(__dirname, '../state/useAuthFlow.ts'), 'utf8');
const migrationPath = join(
  __dirname,
  '../../../../supabase/migrations/20260714000000_delete_anonymous_account.sql',
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

describe('anonymous sign-out cleanup contract', () => {
  it('deletes the anonymous account before signing out', () => {
    expect(authFlow).toContain("rpc('delete_anonymous_account')");
    expect(authFlow).toContain('await supabase.auth.signOut()');
  });

  it('exposes a server-side RPC that deletes the authenticated anonymous user', () => {
    expect(migration).toContain('create or replace function public.delete_anonymous_account()');
    expect(migration).toContain('delete from auth.users');
    expect(migration).toContain("grant execute on function public.delete_anonymous_account() to authenticated");
  });
});
