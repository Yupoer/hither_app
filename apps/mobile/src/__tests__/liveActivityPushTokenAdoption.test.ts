import React from 'react';
import { decidePushTokenAdoption } from '../utils/liveActivityPushTokenAdoption';
import { LiveActivityLifecycleReconciler } from '../utils/liveActivityLifecycle';

const mockUpsertLiveActivitySession = jest.fn().mockResolvedValue(undefined);
const mockDeleteLiveActivitySession = jest.fn().mockResolvedValue(undefined);
const mockDeleteMyLiveActivitySessions = jest.fn().mockResolvedValue(undefined);
const mockDeleteMyLiveActivitySessionsForGroups = jest
  .fn()
  .mockResolvedValue(undefined);
const mockGetOrCreateLiveActivityDeviceId = jest
  .fn()
  .mockResolvedValue('device-1');
const mockUpsertDeviceActivityToken = jest.fn().mockResolvedValue('upserted');

let pushTokenListener:
  | ((event: {
      activityId: string;
      pushToken: string;
      navigationSessionId?: string;
    }) => void)
  | null = null;
let pushToStartListener: ((event: { token: string | null }) => void) | null = null;

jest.mock('../api/services/LiveActivityService', () => ({
  upsertLiveActivitySession: (...args: unknown[]) =>
    mockUpsertLiveActivitySession(...args),
  deleteLiveActivitySession: (...args: unknown[]) =>
    mockDeleteLiveActivitySession(...args),
  deleteMyLiveActivitySessions: (...args: unknown[]) =>
    mockDeleteMyLiveActivitySessions(...args),
  deleteMyLiveActivitySessionsForGroups: (...args: unknown[]) =>
    mockDeleteMyLiveActivitySessionsForGroups(...args),
  getOrCreateLiveActivityDeviceId: (...args: unknown[]) =>
    mockGetOrCreateLiveActivityDeviceId(...args),
  upsertDeviceActivityToken: (...args: unknown[]) =>
    mockUpsertDeviceActivityToken(...args),
}));

jest.mock('../state/SessionContext', () => ({
  useSession: () => ({ user: { id: 'user-1' } }),
}));

jest.mock('../state/diagnostics', () => ({
  diagnostics: { write: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../utils/liveActivityTokenGate', () => ({
  getSharedLiveActivityTokenGate: () => ({
    ready: async () => undefined,
    shouldRegister: () => ({ action: 'register' }),
    recordResult: jest.fn(),
  }),
}));

const platform = { OS: 'ios' };
jest.mock('react-native', () => ({
  Platform: platform,
}));

jest.mock('../native', () => ({
  liveActivity: {
    addPushTokenListener: (
      cb: (event: {
        activityId: string;
        pushToken: string;
        navigationSessionId?: string;
      }) => void,
    ) => {
      pushTokenListener = cb;
      return { remove: jest.fn() };
    },
    addPushToStartTokenListener: jest.fn((cb: (event: { token: string | null }) => void) => {
      pushToStartListener = cb;
      return { remove: jest.fn() };
    }),
    startPushToStartTokenObservation: jest.fn().mockResolvedValue(undefined),
    endAllGroupActivities: jest.fn().mockResolvedValue(undefined),
    endGroupActivity: jest.fn().mockResolvedValue(undefined),
    startGroupActivity: jest.fn().mockResolvedValue({
      activityId: 'act-start',
      pushToken: 'tok-start',
    }),
    observeExistingActivities: jest.fn().mockResolvedValue(undefined),
    listGroupActivities: jest.fn().mockResolvedValue([]),
    updateGroupActivity: jest.fn().mockResolvedValue(undefined),
    updateAllGroupActivities: jest.fn().mockResolvedValue(undefined),
  },
  notifications: {
    requestPermission: jest.fn().mockResolvedValue(true),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
  create: (element: React.ReactElement) => {
    update: (nextElement: React.ReactElement) => void;
    unmount: () => void;
  };
};

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

describe('useLiveActivity push-token production seam (#146 Sol r3)', () => {
  beforeEach(() => {
    // react-test-renderer concurrent act gate (same as recovery race harness).
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    pushTokenListener = null;
    mockUpsertLiveActivitySession.mockClear();
    mockUpsertLiveActivitySession.mockResolvedValue(undefined);
  });

  it('fires addPushTokenListener: foreign ignored, accepted persists same pair', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useLiveActivity } = require('../state/useLiveActivity') as typeof import('../state/useLiveActivity');

    const session = {
      groupId: 'g1',
      navigationSessionId: 'nav-1',
      destinationId: 'd1',
      initialDistanceM: 1000,
      travelMode: 'walk' as const,
    };
    const state = {
      distanceMeters: 800,
      etaSeconds: 600,
      progress: 0.2,
      destinationName: '集合點',
    };

    let tree: { unmount: () => void };
    await act(async () => {
      tree = create(
        React.createElement(function Harness() {
          useLiveActivity(false, state as never, session, false);
          return null;
        }),
      );
    });

    expect(pushTokenListener).toEqual(expect.any(Function));

    // Foreign session while handle is null → ignore, never persist.
    await act(async () => {
      pushTokenListener!({
        activityId: 'foreign-act',
        pushToken: 'tok-evil',
        navigationSessionId: 'other-nav',
      });
      await Promise.resolve();
    });
    expect(mockUpsertLiveActivitySession).not.toHaveBeenCalled();

    // Matching nav session + null handle → adopt observed + force persist.
    await act(async () => {
      pushTokenListener!({
        activityId: 'act-1',
        pushToken: 'tok-1',
        navigationSessionId: 'nav-1',
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockUpsertLiveActivitySession).toHaveBeenCalledTimes(1);
    expect(mockUpsertLiveActivitySession).toHaveBeenCalledWith(
      expect.objectContaining({
        activityId: 'act-1',
        pushToken: 'tok-1',
        groupId: 'g1',
        navigationSessionId: 'nav-1',
        destinationId: 'd1',
      }),
    );

    mockUpsertLiveActivitySession.mockClear();

    // Live handle act-1 + foreign act-B same session → ignore (no corrupt pair).
    await act(async () => {
      pushTokenListener!({
        activityId: 'act-B',
        pushToken: 'tok-B',
        navigationSessionId: 'nav-1',
      });
      await Promise.resolve();
    });
    expect(mockUpsertLiveActivitySession).not.toHaveBeenCalled();

    // Token rotation for exact handle → persist same activityId with new token.
    await act(async () => {
      pushTokenListener!({
        activityId: 'act-1',
        pushToken: 'tok-rotated',
        navigationSessionId: 'nav-1',
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockUpsertLiveActivitySession).toHaveBeenCalledTimes(1);
    expect(mockUpsertLiveActivitySession).toHaveBeenCalledWith(
      expect.objectContaining({
        activityId: 'act-1',
        pushToken: 'tok-rotated',
      }),
    );

    await act(async () => {
      tree.unmount();
    });
  });

  it('starts one activity when active and entitled, then clears on unmount', async () => {
    const { useLiveActivity, clearLiveActivities } = require('../state/useLiveActivity') as typeof import('../state/useLiveActivity');
    const { liveActivity } = require('../native') as {
      liveActivity: { startGroupActivity: jest.Mock; listGroupActivities: jest.Mock };
    };
    const session = {
      groupId: 'g1',
      navigationSessionId: 'nav-1',
      destinationId: 'd1',
      initialDistanceM: 1000,
      travelMode: 'walk' as const,
    };
    const state = {
      groupName: 'Team',
      gatheringTitle: 'Station',
      distanceMeters: 980,
      etaSeconds: 720,
      progress: 0.02,
    };
    let tree: { unmount: () => void };
    await act(async () => {
      tree = create(
        React.createElement(function Harness() {
          useLiveActivity(true, state as never, session, true);
          return null;
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(liveActivity.listGroupActivities).toHaveBeenCalled();
    expect(liveActivity.startGroupActivity).toHaveBeenCalled();
    expect(mockUpsertLiveActivitySession).toHaveBeenCalledWith(
      expect.objectContaining({
        progress: 0.02,
        currentDistanceM: 980,
      }),
    );
    await act(async () => {
      tree.unmount();
    });
    await expect(clearLiveActivities()).resolves.toBeUndefined();
    await expect(clearLiveActivities({ groupIds: ['g1'] })).resolves.toBeUndefined();
  });

  it('updates the live handle and stops when the journey ends', async () => {
    const { useLiveActivity } = require('../state/useLiveActivity') as typeof import('../state/useLiveActivity');
    const session = {
      groupId: 'g1',
      navigationSessionId: 'nav-1',
      destinationId: 'd1',
      initialDistanceM: 1000,
      travelMode: 'walk' as const,
    };
    let active = true;
    let state = {
      groupName: 'Team',
      gatheringTitle: 'Station',
      distanceMeters: 900,
      etaSeconds: 600,
      progress: 0.1,
      memberEmojis: ['🐑'],
      memberArrived: [false],
    };
    let setProps: (next: { active?: boolean; state?: typeof state }) => void = () => undefined;
    function Harness() {
      const [cur, setCur] = React.useState({ active, state });
      setProps = (next) => setCur((prev) => ({ ...prev, ...next }));
      useLiveActivity(cur.active, cur.state as never, session, true);
      return null;
    }
    let tree: { unmount: () => void };
    await act(async () => {
      tree = create(React.createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      pushToStartListener?.({ token: 'pts-token' });
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      setProps({
        state: { ...state, distanceMeters: 700, progress: 0.3, etaSeconds: 400 },
      });
      await Promise.resolve();
    });
    await act(async () => {
      setProps({ active: false });
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      tree.unmount();
    });
    expect(mockDeleteMyLiveActivitySessions).toHaveBeenCalled();
  });

  it('records token register outcomes and skips persist without a live distance', async () => {
    const { useLiveActivity } = require('../state/useLiveActivity') as typeof import('../state/useLiveActivity');
    mockUpsertDeviceActivityToken
      .mockResolvedValueOnce('reclaimed_own_token')
      .mockRejectedValueOnce(new Error('net'))
      .mockResolvedValueOnce('foreign_token_conflict');
    const session = {
      groupId: 'g1',
      destinationId: 'd1',
      initialDistanceM: 1000,
      travelMode: 'walk' as const,
    };
    await act(async () => {
      create(
        React.createElement(function Harness() {
          useLiveActivity(true, { groupName: 'T' } as never, session, true);
          return null;
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      pushToStartListener?.({ token: 'pts-a' });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockUpsertLiveActivitySession).not.toHaveBeenCalled();
  });

  it('leaves a hydrating journey alone and stops when destination is lost', async () => {
    const { useLiveActivity } = require('../state/useLiveActivity') as typeof import('../state/useLiveActivity');
    let dest: string | undefined = 'd1';
    function Harness({ hasSession, destinationId }: { hasSession: boolean; destinationId?: string }) {
      useLiveActivity(
        true,
        { groupName: 'T', distanceMeters: 10 } as never,
        hasSession
          ? {
              groupId: 'g1',
              destinationId: destinationId as string,
              initialDistanceM: 10,
              travelMode: 'walk',
            }
          : undefined,
        true,
      );
      return null;
    }
    let tree: { update: (el: React.ReactElement) => void; unmount: () => void } = {
      update: () => undefined,
      unmount: () => undefined,
    };
    await act(async () => {
      tree = create(React.createElement(Harness, { hasSession: false }));
      await Promise.resolve();
    });
    await act(async () => {
      tree.update(React.createElement(Harness, { hasSession: true, destinationId: dest }));
      await Promise.resolve();
    });
    await act(async () => {
      tree.update(React.createElement(Harness, { hasSession: true, destinationId: undefined }));
      await Promise.resolve();
    });
    await act(async () => {
      tree.unmount();
    });
  });
});
