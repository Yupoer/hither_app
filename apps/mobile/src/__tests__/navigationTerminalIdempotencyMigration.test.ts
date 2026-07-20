import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(
    __dirname,
    '../../../../supabase/migrations/20260719060453_navigation_session_terminal_idempotency.sql',
  ),
  'utf8',
).replace(/\r\n/g, '\n');

const pgtap = readFileSync(
  join(
    __dirname,
    '../../../../supabase/tests/team_navigation_sessions.test.sql',
  ),
  'utf8',
);

describe('navigation terminal idempotency migration', () => {
  it('locks the row and returns same-terminal status without update side effects', () => {
    expect(migration).toContain('for update');
    expect(migration).toMatch(
      /if v_session\.status = 'cancelled' then\s+return v_session;/s,
    );
    expect(migration).toMatch(
      /if v_session\.status = 'completed' then\s+return v_session;/s,
    );
  });

  it('keeps active version mismatches as SQLSTATE 40001', () => {
    expect(migration).toContain("errcode = '40001'");
    expect(migration).toContain('active navigation session version mismatch');
    expect(migration).toMatch(
      /if v_session\.version <> p_expected_version then/s,
    );
  });

  it('rejects opposite-terminal actions with P0001', () => {
    expect(migration).toContain("errcode = 'P0001'");
    expect(migration).toContain("raise exception 'navigation session is already %'");
  });

  it('reasserts execute grants to authenticated only', () => {
    for (const rpc of [
      'cancel_navigation_session(uuid, integer)',
      'complete_navigation_session(uuid, integer)',
    ]) {
      expect(migration).toContain(
        `revoke all on function public.${rpc}\n  from public, anon;`,
      );
      expect(migration).toContain(
        `grant execute on function public.${rpc}\n  to authenticated;`,
      );
    }
  });

  it('extends pgTAP with replay, opposite-terminal, and stale-active coverage', () => {
    expect(pgtap).toContain('select plan(37);');
    const assertionCount = (
      pgtap.match(
        /^select\s+(?:has_table|is|lives_ok|throws_ok)\s*\(/gim,
      ) ?? []
    ).length;
    expect(assertionCount).toBe(37);

    // Stale-active fixture must use an open stop (bbb3 after cancel), not a closed one.
    const staleStart = pgtap.indexOf('create temporary table active_stale_session');
    const staleEnd = pgtap.indexOf(
      'a genuinely stale active version still raises 40001',
    );
    expect(staleStart).toBeGreaterThanOrEqual(0);
    expect(staleEnd).toBeGreaterThan(staleStart);
    const staleBlock = pgtap.slice(staleStart, staleEnd);
    expect(staleBlock).toContain('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3');
    expect(staleBlock).not.toContain('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(staleBlock).not.toContain('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2');

    expect(pgtap).toContain(
      'replaying complete returns the already-completed session',
    );
    expect(pgtap).toContain(
      'replaying complete does not increment the terminal version',
    );
    expect(pgtap).toContain(
      'replaying cancel returns the already-cancelled session',
    );
    expect(pgtap).toContain(
      'replaying cancel does not increment the terminal version',
    );
    expect(pgtap).toContain(
      'complete does not claim success for a cancelled session',
    );
    expect(pgtap).toContain(
      'a genuinely stale active version still raises 40001',
    );
  });
});
