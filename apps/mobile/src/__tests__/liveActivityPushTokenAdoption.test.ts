import { decidePushTokenAdoption } from '../utils/liveActivityPushTokenAdoption';
import { LiveActivityLifecycleReconciler } from '../utils/liveActivityLifecycle';

describe('decidePushTokenAdoption (#146 Sol)', () => {
  it('adopts token rotation for the exact active handle', () => {
    const decision = decidePushTokenAdoption({
      eventActivityId: 'act-1',
      eventPushToken: 'tok-rotated',
      eventNavigationSessionId: 'nav-1',
      currentHandle: 'act-1',
      currentNavigationSessionId: 'nav-1',
    });
    expect(decision).toEqual({
      action: 'adopt',
      activityId: 'act-1',
      pushToken: 'tok-rotated',
      observeExisting: false,
    });
  });

  it('ignores null handle + foreign session (no adopt, no persist path)', () => {
    const decision = decidePushTokenAdoption({
      eventActivityId: 'foreign-act',
      eventPushToken: 'tok-evil',
      eventNavigationSessionId: 'other-nav',
      currentHandle: null,
      currentNavigationSessionId: 'nav-1',
    });
    expect(decision.action).toBe('ignore');
  });

  it('ignores null handle when navigation session is missing on the event', () => {
    const decision = decidePushTokenAdoption({
      eventActivityId: 'act-x',
      eventPushToken: 'tok-x',
      eventNavigationSessionId: undefined,
      currentHandle: null,
      currentNavigationSessionId: 'nav-1',
    });
    expect(decision.action).toBe('ignore');
  });

  it('adopts observed activity when handle is null and session matches', () => {
    const decision = decidePushTokenAdoption({
      eventActivityId: 'recovered',
      eventPushToken: 'tok-obs',
      eventNavigationSessionId: 'nav-1',
      currentHandle: null,
      currentNavigationSessionId: 'nav-1',
    });
    expect(decision).toEqual({
      action: 'adopt',
      activityId: 'recovered',
      pushToken: 'tok-obs',
      observeExisting: true,
    });
  });

  it('ignores handle A + same-session event B (no corrupt id/token pair)', () => {
    const decision = decidePushTokenAdoption({
      eventActivityId: 'act-B',
      eventPushToken: 'tok-B',
      eventNavigationSessionId: 'nav-1',
      currentHandle: 'act-A',
      currentNavigationSessionId: 'nav-1',
    });
    expect(decision.action).toBe('ignore');
  });

  it('reconciler adopt failure prevents pairing foreign id with live token', async () => {
    const api = {
      endGroupActivity: jest.fn(async () => undefined),
      endAllGroupActivities: jest.fn(async () => undefined),
      startGroupActivity: jest.fn(async () => ({
        activityId: 'act-A',
        pushToken: 'tok-A',
      })),
      deleteSession: jest.fn(async () => undefined),
      deleteAllSessions: jest.fn(async () => undefined),
    };
    const reconciler = new LiveActivityLifecycleReconciler(api);
    await reconciler.request({ kind: 'start', destinationId: 'd1' });
    expect(reconciler.currentHandle).toBe('act-A');
    expect(reconciler.currentPushToken).toBe('tok-A');

    const decision = decidePushTokenAdoption({
      eventActivityId: 'act-B',
      eventPushToken: 'tok-B',
      eventNavigationSessionId: 'nav-1',
      currentHandle: reconciler.currentHandle,
      currentNavigationSessionId: 'nav-1',
    });
    expect(decision.action).toBe('ignore');
    // Even if a caller tried observe, adopt must fail and leave pairing intact.
    expect(
      reconciler.adoptObservedActivity({
        activityId: 'act-B',
        pushToken: 'tok-B',
      }),
    ).toBe(false);
    expect(reconciler.currentHandle).toBe('act-A');
    expect(reconciler.currentPushToken).toBe('tok-A');
  });
});

describe('useLiveActivity push-token seam contracts', () => {
  it('gates listener on decidePushTokenAdoption before persist', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');
    const liveHook = fs.readFileSync(
      path.join(__dirname, '../state/useLiveActivity.ts'),
      'utf8',
    );
    expect(liveHook).toContain('decidePushTokenAdoption');
    expect(liveHook).toContain("if (decision.action === 'ignore') return");
    expect(liveHook).toContain('if (!adopted) return');
    expect(liveHook).toContain('persistSession(decision.activityId');
  });
});
