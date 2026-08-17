import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const authFlow = readFileSync(join(__dirname, '../state/useAuthFlow.ts'), 'utf8');
const session = readFileSync(join(__dirname, '../state/SessionContext.tsx'), 'utf8');
const migrationsDir = join(__dirname, '../../../../supabase/migrations');
const originalMigrationPath = join(
  migrationsDir,
  '20260714000000_delete_anonymous_account.sql',
);
const originalMigration = existsSync(originalMigrationPath)
  ? readFileSync(originalMigrationPath, 'utf8')
  : '';

function latestDeleteAccountSql(): string {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  let latest = '';
  for (const name of files) {
    const sql = readFileSync(join(migrationsDir, name), 'utf8');
    if (/create or replace function public\.delete_anonymous_account\s*\(/i.test(sql)) {
      latest = sql;
    }
  }
  return latest;
}

describe('anonymous sign-out cleanup contract', () => {
  it('deletes the anonymous account before signing out', () => {
    expect(authFlow).toContain("rpc('delete_anonymous_account')");
    expect(authFlow).toContain('await supabase.auth.signOut()');
  });

  it('exposes a server-side RPC that deletes the authenticated anonymous user', () => {
    expect(originalMigration).toContain('create or replace function public.delete_anonymous_account()');
    expect(originalMigration).toContain('delete from auth.users');
    expect(originalMigration).toContain("grant execute on function public.delete_anonymous_account() to authenticated");
  });

  it('keeps the RPC permanently deleting auth.users and allows registered self-delete', () => {
    const latest = latestDeleteAccountSql();
    expect(latest).toContain('create or replace function public.delete_anonymous_account()');
    expect(latest).toContain('delete from auth.users');
    expect(latest).not.toContain('Only anonymous accounts can be deleted by logout');
    expect(latest).toContain('navigation_sessions');
    expect(latest).toContain('daily_accommodations');
  });

  it('keeps registered signOut session-only while deleteAccount always RPCs', () => {
    const signOutStart = authFlow.indexOf('const signOut = useCallback');
    const deleteStart = authFlow.indexOf('const deleteAccount = useCallback');
    expect(signOutStart).toBeGreaterThanOrEqual(0);
    expect(deleteStart).toBeGreaterThanOrEqual(0);
    const signOutBlock = authFlow.slice(signOutStart, deleteStart > signOutStart ? deleteStart : undefined);
    expect(signOutBlock).toContain('if (isAnonymous)');
    expect(session).toContain('deleteAccount:');
    expect(authFlow).toContain("rpc('delete_anonymous_account')");
  });
});
