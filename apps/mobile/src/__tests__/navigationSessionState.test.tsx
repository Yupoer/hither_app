import React from 'react';
import type {
  MemberNavigationState,
  NavigationSession,
} from '../types/navigation';
import { clearNavigationTerminalMutationStateForTests } from '../state/navigationTerminalMutation';
import { useNavigationSession } from '../state/useNavigationSession';

const callbacks: {
  session?: (session: NavigationSession) => void;
  member?: (state: MemberNavigationState) => void;
} = {};

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    sessionId: 'device-session-1234',
    nativeBuildVersion: '42',
    expoConfig: { version: '0.1.3' },
  },
}));
jest.mock('expo-updates', () => ({
  updateId: 'eas-update-test',
  runtimeVersion: '56.0.0',
}));
jest.mock('../state/diagnostics', () => ({
  diagnostics: { write: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../api/services/NavigationService', () => ({
  getActiveNavigationSession: jest.fn(),
  getMyNavigationMemberState: jest.fn(),
  subscribeNavigationSession: jest.fn(
    async (
      _groupId: string,
      onSession: (session: NavigationSession) => void,
      onMember: (state: MemberNavigationState) => void,
    ) => {
      callbacks.session = onSession;
      callbacks.member = onMember;
      return jest.fn();
    },
  ),
  startNavigationSession: jest.fn(),
  cancelNavigationSession: jest.fn(),
  completeNavigationSession: jest.fn(),
  ackNavigationSession: jest.fn(),
}));

import {
  cancelNavigationSession,
  getActiveNavigationSession,
  getMyNavigationMemberState,
} from '../api/services/NavigationService';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
  create: (element: React.ReactElement) => unknown;
};

const session = (version: number, status: NavigationSession['status'] = 'active') => ({
  id: 'session-1',
  groupId: 'group-1',
  destinationId: 'destination-1',
  destination: {
    name: '車站',
    coordinates: { latitude: 25.0478, longitude: 121.517 },
    arrivalRadiusMeters: 50,
  },
  startedBy: 'leader-1',
  requestId: 'request-1',
  startedAt: '2026-07-17T00:00:00Z',
  expiresAt: '2026-07-17T06:00:00Z',
  status,
  version,
});

describe('useNavigationSession', () => {
  beforeEach(() => {
    clearNavigationTerminalMutationStateForTests();
    callbacks.session = undefined;
    callbacks.member = undefined;
    jest.clearAllMocks();
    jest.mocked(getActiveNavigationSession).mockResolvedValue(session(2));
    jest.mocked(getMyNavigationMemberState).mockResolvedValue(null);
  });

  it('hydrates the active session and ignores stale realtime versions', async () => {
    let value: ReturnType<typeof useNavigationSession> | undefined;
    function Harness() {
      value = useNavigationSession('group-1');
      return null;
    }

    await act(async () => {
      create(React.createElement(Harness));
    });
    expect(value?.session?.version).toBe(2);

    act(() => callbacks.session?.(session(1)));
    expect(value?.session?.version).toBe(2);

    act(() => callbacks.session?.(session(3)));
    expect(value?.session?.version).toBe(3);
  });

  it('clears terminal sessions and ignores member events for another session', async () => {
    let value: ReturnType<typeof useNavigationSession> | undefined;
    function Harness() {
      value = useNavigationSession('group-1');
      return null;
    }
    await act(async () => {
      create(React.createElement(Harness));
    });

    act(() => callbacks.member?.({
      navigationSessionId: 'other-session',
      userId: 'user-1',
      localStatus: 'tracking_active',
      detail: {},
      latestDistanceMeters: null,
      latestAccuracyMeters: null,
      liveActivityId: null,
      acknowledgedAt: null,
      arrivedAt: null,
      updatedAt: '2026-07-17T00:00:01Z',
    }));
    expect(value?.memberState).toBeNull();

    act(() => callbacks.session?.(session(3, 'cancelled')));
    expect(value?.session).toBeNull();
    expect(value?.memberState).toBeNull();
  });

  it('coalesces concurrent cancel calls', async () => {
    let value: ReturnType<typeof useNavigationSession> | undefined;
    function Harness() {
      value = useNavigationSession('group-1');
      return null;
    }
    await act(async () => {
      create(React.createElement(Harness));
    });

    let resolveCancel!: (session: NavigationSession) => void;
    const cancelPromise = new Promise<NavigationSession>((resolve) => {
      resolveCancel = resolve;
    });
    jest.mocked(cancelNavigationSession).mockReturnValue(cancelPromise);
    const cancelledSession = session(4, 'cancelled');

    let first!: Promise<NavigationSession | null>;
    let second!: Promise<NavigationSession | null>;
    await act(async () => {
      first = value!.cancel();
      second = value!.cancel();
    });
    expect(cancelNavigationSession).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveCancel(cancelledSession);
      await Promise.all([first, second]);
    });
    await expect(Promise.all([first, second])).resolves.toEqual([
      cancelledSession,
      cancelledSession,
    ]);
  });

  it('refreshes once instead of retrying a stale version', async () => {
    let value: ReturnType<typeof useNavigationSession> | undefined;
    function Harness() {
      value = useNavigationSession('group-1');
      return null;
    }
    await act(async () => {
      create(React.createElement(Harness));
    });

    jest.mocked(cancelNavigationSession).mockRejectedValue({ code: '40001' });
    jest.mocked(getActiveNavigationSession).mockResolvedValue(null);
    await act(async () => {
      await value!.cancel();
    });
    expect(cancelNavigationSession).toHaveBeenCalledTimes(1);
    // initial hydrate + one refresh after 40001
    expect(getActiveNavigationSession).toHaveBeenCalledTimes(2);

    // Synthetic realtime reintroduces the same stale session/version after reconcile.
    act(() => callbacks.session?.(session(2)));
    await act(async () => {
      await value!.cancel();
    });
    expect(cancelNavigationSession).toHaveBeenCalledTimes(1);
  });
});
