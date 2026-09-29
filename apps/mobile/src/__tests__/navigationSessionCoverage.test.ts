import React from 'react';
import type { MemberNavigationState, NavigationSession } from '../types/navigation';

const mockAppState: {
  currentState: string,
  listener: ((state: string) => void) | undefined,
  remove: jest.Mock,
  addEventListener: jest.Mock,
} = {
  currentState: 'active',
  listener: undefined,
  remove: jest.fn(),
  addEventListener: jest.fn(),
};
mockAppState.addEventListener.mockImplementation((_event: string, listener: (state: string) => void) => {
  mockAppState.listener = listener;
  return { remove: mockAppState.remove };
});
const unsubscribe = jest.fn();
const mockGetActive = jest.fn() as jest.Mock;
const mockGetMember = jest.fn() as jest.Mock;
const mockSubscribe = jest.fn() as jest.Mock;
const mockStart = jest.fn() as jest.Mock;
const mockCancel = jest.fn() as jest.Mock;
const mockComplete = jest.fn() as jest.Mock;
const mockAck = jest.fn() as jest.Mock;
const mockRequireUserId = jest.fn(async (..._args: unknown[]) => 'user-1');
const mockEnqueueResponse = jest.fn(async (..._args: unknown[]) => undefined);
const mockDiagnostics = { write: jest.fn(async () => undefined) };
let sessionCallback: ((session: NavigationSession) => void) | undefined;
let memberCallback: ((state: MemberNavigationState) => void) | undefined;

jest.mock('react-native', () => ({ AppState: mockAppState }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { nativeBuildVersion: '42', expoConfig: { version: '0.1.0' } },
}));
jest.mock('expo-updates', () => ({ updateId: 'update-1', runtimeVersion: '56.0.0' }));
jest.mock('../state/diagnostics', () => ({ diagnostics: mockDiagnostics }));
jest.mock('../api/services/_helpers', () => ({ requireUserId: (...args: unknown[]) => mockRequireUserId(...args) }));
jest.mock('../state/coreDataSync', () => ({ enqueuePersonalNavigationResponse: (...args: unknown[]) => mockEnqueueResponse(...args) }));
jest.mock('../api/services/NavigationService', () => ({
  getActiveNavigationSession: (...args: unknown[]) => mockGetActive(...args),
  getMyNavigationMemberState: (...args: unknown[]) => mockGetMember(...args),
  subscribeNavigationSession: (
    groupId: string,
    onSession: (session: NavigationSession) => void,
    onMember: (state: MemberNavigationState) => void,
  ) => mockSubscribe(groupId, onSession, onMember),
  startNavigationSession: (...args: unknown[]) => mockStart(...args),
  cancelNavigationSession: (...args: unknown[]) => mockCancel(...args),
  completeNavigationSession: (...args: unknown[]) => mockComplete(...args),
  ackNavigationSession: (...args: unknown[]) => mockAck(...args),
}));

const { useNavigationSession } = require('../state/useNavigationSession') as typeof import('../state/useNavigationSession');

const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
  create: (element: React.ReactElement) => { unmount: () => void };
};

function session(id = 'session-1', version = 1, status: NavigationSession['status'] = 'active'): NavigationSession {
  return {
    id,
    groupId: 'group-1',
    destinationId: 'destination-1',
    destination: {
      name: 'Station',
      coordinates: { latitude: 25, longitude: 121 },
      arrivalRadiusMeters: 50,
    },
    startedBy: 'leader-1',
    requestId: 'request-1',
    startedAt: '2026-09-19T00:00:00Z',
    expiresAt: '2026-09-19T08:00:00Z',
    status,
    version,
  };
}

const member = (navigationSessionId: string): MemberNavigationState => ({
  navigationSessionId,
  userId: 'user-1',
  localStatus: 'tracking_active',
  detail: {},
  latestDistanceMeters: 100,
  latestAccuracyMeters: 8,
  liveActivityId: null,
  acknowledgedAt: null,
  arrivedAt: null,
  updatedAt: '2026-09-19T00:00:00Z',
});

async function mount(groupId: string | null) {
  let value!: ReturnType<typeof useNavigationSession>;
  function Probe() {
    value = useNavigationSession(groupId);
    return null;
  }
  let tree!: { unmount: () => void };
  await act(async () => {
    tree = create(React.createElement(Probe));
  });
  return { value: () => value, tree };
}

describe('useNavigationSession lifecycle and mutations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAppState.currentState = 'active';
    mockAppState.listener = undefined;
    mockGetActive.mockResolvedValue(session());
    mockGetMember.mockResolvedValue(member('session-1'));
    mockSubscribe.mockImplementation(async (
      _group: string,
      onSession: (next: NavigationSession) => void,
      onMember: (next: MemberNavigationState) => void,
    ) => {
      sessionCallback = onSession;
      memberCallback = onMember;
    return unsubscribe;
    });
    mockStart.mockResolvedValue(session('session-started', 1));
    mockCancel.mockResolvedValue(session('session-1', 2, 'cancelled'));
    mockComplete.mockResolvedValue(session('session-1', 2, 'completed'));
    mockAck.mockResolvedValue(member('session-1'));
    sessionCallback = undefined;
    memberCallback = undefined;
  });

  it('handles missing groups without starting listeners and reports refresh failures', async () => {
    const empty = await mount(null);
    expect(empty.value().loading).toBe(false);
    await expect(empty.value().start('destination', 'request')).rejects.toThrow('缺少群組');
    await expect(empty.value().refresh()).resolves.toBeNull();
    empty.tree.unmount();

    mockGetActive.mockRejectedValue(Object.assign(new Error('offline'), { code: 'network' }));
    const failing = await mount('group-1');
    await act(async () => { await failing.value().refresh(); });
    expect(failing.value().error).toEqual(expect.any(String));
    failing.tree.unmount();
  });

  it('hydrates session/member state, filters realtime membership, and supports start/ack/respond', async () => {
    const view = await mount('group-1');
    expect(view.value().session?.id).toBe('session-1');
    expect(view.value().memberState?.navigationSessionId).toBe('session-1');

    await act(async () => memberCallback?.(member('other-session')));
    expect(view.value().memberState?.navigationSessionId).toBe('session-1');
    await act(async () => memberCallback?.({ ...member('session-1'), localStatus: 'arriving' }));
    expect(view.value().memberState?.localStatus).toBe('arriving');

    await act(async () => { await view.value().start('destination-2', 'request-2', true); });
    expect(mockStart).toHaveBeenCalledWith('group-1', 'destination-2', 'request-2', true);
    expect(view.value().session?.id).toBe('session-started');
    await act(async () => { await view.value().ack('arriving', { distanceM: 10 }); });
    expect(mockAck).toHaveBeenCalledWith('session-started', 'arriving', { distanceM: 10 });
    await act(async () => { await view.value().respondToAnnouncement('acknowledged'); });
    expect(mockEnqueueResponse).toHaveBeenCalledWith(expect.objectContaining({
      groupId: 'group-1', sessionId: 'session-started', userId: 'user-1', response: 'acknowledged',
    }));
    view.tree.unmount();
  });

  it('cancels and completes through versioned terminal mutations', async () => {
    const view = await mount('group-1');
    await act(async () => { await view.value().cancel(); });
    expect(mockCancel).toHaveBeenCalledWith('session-1', 1);
    expect(view.value().session).toBeNull();

    mockGetActive.mockResolvedValueOnce(session('session-2', 1));
    await act(async () => { await view.value().refresh(); });
    mockComplete.mockResolvedValueOnce(session('session-2', 2, 'completed'));
    await act(async () => { await view.value().complete(); });
    expect(mockComplete).toHaveBeenCalledWith('session-2', 1);
    expect(view.value().session).toBeNull();
    view.tree.unmount();
  });

  it('unsubscribes in background and refreshes once on foreground recovery', async () => {
    const view = await mount('group-1');
    const callsBeforeBackground = mockGetActive.mock.calls.length;
    unsubscribe.mockClear();
    await act(async () => {
      mockAppState.currentState = 'background';
      mockAppState.listener?.('background');
    });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    await act(async () => {
      mockGetActive.mockResolvedValueOnce(session('session-3', 3));
      mockAppState.currentState = 'active';
      mockAppState.listener?.('active');
    });
    expect(mockGetActive.mock.calls.length).toBeGreaterThan(callsBeforeBackground);
    expect(view.value().session?.id).toBe('session-3');
    view.tree.unmount();
    expect(mockAppState.remove).toHaveBeenCalled();
  });

  it('clears stale and terminal events without reviving a newer session', async () => {
    const view = await mount('group-1');
    await act(async () => sessionCallback?.(session('session-2', 2)));
    await act(async () => sessionCallback?.(session('session-1', 99, 'cancelled')));
    expect(view.value().session?.id).toBe('session-2');
    await act(async () => sessionCallback?.(session('session-2', 3, 'completed')));
    expect(view.value().session).toBeNull();
    await act(async () => sessionCallback?.(session('session-2', 4)));
    expect(view.value().session).toBeNull();
    view.tree.unmount();
  });
});
