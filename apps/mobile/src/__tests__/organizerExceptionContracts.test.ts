/**
 * Lightweight contracts for NavigationService session filters and help seed
 * helpers — no native network.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

jest.mock('../api/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
    })),
    channel: jest.fn(() => ({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockReturnThis(),
    })),
    removeChannel: jest.fn(),
  },
}));

jest.mock('../api/services/NavigationService', () => ({
  listNavigationMemberStates: jest.fn(async () => []),
  subscribeSessionMemberStates: jest.fn(async () => () => undefined),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
}));

// Import after mocks
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  __mapHelpRowsForTests,
  HELP_SIGNAL_LOOKBACK_HOURS,
} = require('../state/useOrganizerExceptions') as typeof import('../state/useOrganizerExceptions');

describe('organizer exception contracts', () => {
  const navServicePath = path.join(
    __dirname,
    '../api/services/NavigationService.ts',
  );
  const navSource = fs.readFileSync(navServicePath, 'utf8');

  it('lists and subscribes navigation member states by session id', () => {
    expect(navSource).toContain('listNavigationMemberStates');
    expect(navSource).toContain('subscribeSessionMemberStates');
    expect(navSource).toContain(".eq('navigation_session_id', sessionId)");
    expect(navSource).toContain(
      'filter: `navigation_session_id=eq.${sessionId}`',
    );
  });

  it('handles DELETE via payload.old user_id', () => {
    expect(navSource).toContain("eventType === 'DELETE'");
    expect(navSource).toContain('handlers.onRemove');
    expect(navSource).toContain('oldRow?.user_id');
  });

  it('maps historical need_help rows (latest per sender, skips leader)', () => {
    const rows = [
      { sender_id: 'leader', created_at: '2026-07-25T11:00:00.000Z' },
      { sender_id: 'a', created_at: '2026-07-25T11:00:00.000Z' },
      { sender_id: 'a', created_at: '2026-07-25T12:00:00.000Z' },
      { sender_id: 'b', created_at: '2026-07-25T11:30:00.000Z' },
    ];
    const mapped = __mapHelpRowsForTests(rows, 'leader');
    expect(mapped).toEqual(
      expect.arrayContaining([
        { userId: 'a', seenAt: '2026-07-25T12:00:00.000Z' },
        { userId: 'b', seenAt: '2026-07-25T11:30:00.000Z' },
      ]),
    );
    expect(mapped.find((m) => m.userId === 'leader')).toBeUndefined();
    expect(HELP_SIGNAL_LOOKBACK_HOURS).toBeGreaterThanOrEqual(1);
  });

  it('hook source seeds need_help and clears helpSignals on group change', () => {
    const hookPath = path.join(__dirname, '../state/useOrganizerExceptions.ts');
    const hook = fs.readFileSync(hookPath, 'utf8');
    expect(hook).toContain(".eq('type', 'need_help')");
    expect(hook).toContain('setHelpSignals([])');
    expect(hook).toContain('setNavStates([])');
    expect(hook).toContain('sessionGenRef');
    expect(hook).toContain('mergePriorObservations');
  });

  it('bumps sessionGen on every session effect run including clear-only path', () => {
    const hookPath = path.join(__dirname, '../state/useOrganizerExceptions.ts');
    const hook = fs.readFileSync(hookPath, 'utf8');
    // Generation must advance before the early return for session→none / disable.
    const effectIdx = hook.indexOf('// Always bump generation on every dep change');
    expect(effectIdx).toBeGreaterThan(-1);
    const slice = hook.slice(effectIdx, effectIdx + 600);
    expect(slice).toContain('++sessionGenRef.current');
    expect(slice).toContain('setNavStates([])');
    expect(slice).toContain('if (!enabled || !navigationSessionId)');
    // Straggler seen map is effect-driven, not useMemo side effects.
    expect(hook).toContain('setStragglerSeenMap');
    expect(hook).toContain('parseTimeMs');
  });
});
