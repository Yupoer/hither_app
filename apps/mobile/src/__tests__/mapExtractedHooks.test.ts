import { useMemberPresence, type UseMemberPresenceInput } from '../screens/MapScreen/hooks/useMemberPresence';
import { getNotificationPreferences, setNotificationPreferences, setSolo } from '../api/client';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../types';
import { useGatheringCompletion, type UseGatheringCompletionInput } from '../screens/MapScreen/hooks/useGatheringCompletion';
import { enqueueJourneyCompletion } from '../state/journeyCompletion';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useStoreEntitlements, type UseStoreEntitlementsInput } from '../screens/MapScreen/hooks/useStoreEntitlements';
import { useVisitHistory, type UseVisitHistoryInput } from '../screens/MapScreen/hooks/useVisitHistory';
import { useGroupActions, type UseGroupActionsInput } from '../screens/MapScreen/hooks/useGroupActions';
import { useAccountActions, type UseAccountActionsInput } from '../screens/MapScreen/hooks/useAccountActions';
import { useStragglerReporting, type UseStragglerReportingInput } from '../screens/MapScreen/hooks/useStragglerReporting';
import { getStoreSnapshot } from '../api/services/StoreService';
import { fetchVisitedWaypoints, leaveGroups, reportStraggler } from '../api/client';
import { Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { clearLiveActivities } from '../state/useLiveActivity';
import { useStragglerAlerts } from '../state/useStragglerAlerts';

jest.mock('../state/journeyCompletion', () => ({ enqueueJourneyCompletion: jest.fn() }));
jest.mock('../native/notifications', () => ({ notifyThisDeviceAutoComplete: jest.fn() }));
jest.mock('react-native', () => ({ Alert: { alert: jest.fn() }, Share: { share: jest.fn() } }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('../api/client', () => ({
  fetchVisitedWaypoints: jest.fn(), leaveGroups: jest.fn(), reportStraggler: jest.fn(),
  saveOnboardingProfile: jest.fn(), getNotificationPreferences: jest.fn(), setNotificationPreferences: jest.fn(), setSolo: jest.fn(),
}));
jest.mock('../api/services/StoreService', () => ({ getStoreSnapshot: jest.fn() }));
jest.mock('../state/useLiveActivity', () => ({ clearLiveActivities: jest.fn() }));
jest.mock('../state/useStragglerAlerts', () => ({ useStragglerAlerts: jest.fn() }));
jest.mock('../featureTour', () => ({
  clearGroupFeatureTour: jest.fn(), clearAddPlaceTour: jest.fn(), clearRouteReorderTour: jest.fn(),
}));
jest.mock('../onboarding/sync', () => ({ markOnboardingReplayForHome: jest.fn() }));
jest.mock('../utils/activityLog', () => ({ logEvent: jest.fn(), logError: jest.fn() }));
jest.mock('../utils/haptics', () => ({ lightTap: jest.fn(), selectionTick: jest.fn() }));
jest.mock('../utils/confirm', () => ({ confirmAction: (_: unknown, confirm: () => void) => confirm() }));
jest.mock('../utils/uiAction', () => ({
  runUiAction: (_: string, action: (token: { isCurrent: () => boolean }) => unknown) =>
    Promise.resolve().then(() => action({ isCurrent: () => true })).catch(() => undefined),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function mountHook<I, O>(hook: (input: I) => O, input: I) {
  let value!: O;
  let root!: ReactTestRenderer;
  function Harness({ input: next }: { input: I }) { value = hook(next); return null; }
  await act(async () => { root = create(React.createElement(Harness, { input })); });
  return {
    get value() { return value; },
    async update(next: I) { await act(async () => { root.update(React.createElement(Harness, { input: next })); }); },
    async unmount() { await act(async () => { root.unmount(); }); },
  };
}

const t = (key: string) => key;

describe('MapScreen extracted hooks', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('rejects an old team store response and keeps Premium Live Activity available offline', async () => {
    const old = deferred<Awaited<ReturnType<typeof getStoreSnapshot>>>();
    jest.mocked(getStoreSnapshot).mockReturnValueOnce(old.promise).mockRejectedValueOnce(new Error('offline'));
    const input: UseStoreEntitlementsInput = {
      groupId: 'old', isAnonymous: false, isPro: false, openPaywall: jest.fn(),
      refreshEntitlement: jest.fn(), syncFromDatabase: jest.fn(),
      setExtraPointCredits: jest.fn(), setLiveActivityEffective: jest.fn(),
    };
    const mounted = await mountHook(useStoreEntitlements, input);
    await mounted.update({ ...input, groupId: 'new', isPro: true });
    expect(input.setLiveActivityEffective).toHaveBeenLastCalledWith(true);
    jest.mocked(input.setExtraPointCredits).mockClear();
    await act(async () => { old.resolve({ liveActivityEffective: false, extraPointCredits: 50 } as Awaited<ReturnType<typeof getStoreSnapshot>>); });
    expect(input.setExtraPointCredits).not.toHaveBeenCalled();
    expect(input.setLiveActivityEffective).toHaveBeenLastCalledWith(true);
    await mounted.unmount();
  });

  it('does not fetch store entitlements for anonymous users', async () => {
    const input: UseStoreEntitlementsInput = {
      groupId: 'team', isAnonymous: true, isPro: false, openPaywall: jest.fn(),
      refreshEntitlement: jest.fn(), syncFromDatabase: jest.fn(),
      setExtraPointCredits: jest.fn(), setLiveActivityEffective: jest.fn(),
    };
    const mounted = await mountHook(useStoreEntitlements, input);
    expect(getStoreSnapshot).not.toHaveBeenCalled();
    expect(input.setLiveActivityEffective).toHaveBeenCalledWith(false);
    expect(input.setExtraPointCredits).toHaveBeenCalledWith(0);
    await mounted.unmount();
  });

  it('renders projected local arrivals before disconnected history finishes', async () => {
    const remote = deferred<Awaited<ReturnType<typeof fetchVisitedWaypoints>>>();
    jest.mocked(fetchVisitedWaypoints).mockReturnValue(remote.promise);
    const input: UseVisitHistoryInput = {
      allScopedDestinations: [{ id: 'stop', title: 'Temple', coordinates: { latitude: 1, longitude: 2 }, order: 0, day: 1, closedAt: '2026-10-22T01:00:00Z' }],
      destinationArrivals: [{ id: 'arrival', groupId: 'team', destinationId: 'stop', userId: 'me', arrivedAt: '2026-10-22T01:00:00Z', source: 'manual', markedBy: 'me' }],
      arrivalOperations: [], group: null, groupId: 'team', isLeader: false, members: [],
      overlay: 'history', routeDepartureDate: undefined, routeTripDays: undefined,
      user: { id: 'me', name: 'Me', email: 'me@example.test' },
    };
    const mounted = await mountHook(useVisitHistory, input);
    expect(mounted.value.historyGroups.flatMap(day => day.items).map(item => item.name)).toContain('Temple');
    await act(async () => { remote.resolve([]); });
    expect(mounted.value.historyGroups.flatMap(day => day.items).map(item => item.name)).toContain('Temple');
    await mounted.unmount();
  });

  it('blocks anonymous leader invite copying and opens registration from its alert', async () => {
    const input = {
      group: { inviteCode: 'CODE' }, isAnonymous: true, members: Array.from({ length: 5 }, () => ({})),
      navigation: { reset: jest.fn() }, role: 'leader', setOverlay: jest.fn(), t,
    } as unknown as UseGroupActionsInput;
    const mounted = await mountHook(useGroupActions, input);
    await act(async () => { await mounted.value.copyCode(); });
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
    const buttons = jest.mocked(Alert.alert).mock.calls[0][2];
    buttons?.[1]?.onPress?.();
    expect(input.setOverlay).toHaveBeenCalledWith('account');
    await mounted.unmount();
  });

  it('returns home without leaving the group or signing out', async () => {
    const input = {
      group: null, isAnonymous: false, members: [], role: 'member',
      navigation: { reset: jest.fn() }, setOverlay: jest.fn(), t,
    } as unknown as UseGroupActionsInput;
    const mounted = await mountHook(useGroupActions, input);
    await act(async () => { mounted.value.goHomeCreateOrJoin(); });
    expect(input.setOverlay).toHaveBeenCalledWith(null);
    expect(input.navigation.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'RoleSelect' }] });
    expect(leaveGroups).not.toHaveBeenCalled();
    await mounted.unmount();
  });

  it('clears Live Activities before leaving and resets the leave marker on failure', async () => {
    const input = {
      groupId: 'team', isLeader: true, leaveGroup: jest.fn(), navigation: { reset: jest.fn() },
      reevaluateRouteTour: jest.fn(), setAddPlaceTourLocalDone: jest.fn(), signOut: jest.fn(),
      updateProfile: jest.fn(), user: null, voluntaryLeaveRef: { current: false }, t,
    } as unknown as UseAccountActionsInput;
    jest.mocked(leaveGroups).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'));
    const mounted = await mountHook(useAccountActions, input);
    await act(async () => { mounted.value.confirmLeave(); });
    expect(clearLiveActivities).toHaveBeenCalledWith({ groupIds: ['team'] });
    expect(input.leaveGroup).toHaveBeenCalledTimes(1);
    expect(input.navigation.reset).toHaveBeenCalledTimes(1);
    await act(async () => { mounted.value.confirmLeave(); });
    expect(input.voluntaryLeaveRef.current).toBe(false);
    expect(input.leaveGroup).toHaveBeenCalledTimes(1);
    await mounted.unmount();
  });

  it('reports each newly flagged straggler once and absorbs transport failure', async () => {
    const flagged = [{ userId: 'peer', distanceM: 900 }];
    jest.mocked(useStragglerAlerts).mockReturnValue({ stragglers: flagged } as ReturnType<typeof useStragglerAlerts>);
    jest.mocked(reportStraggler).mockRejectedValue(new Error('offline'));
    const input = { groupId: 'team', group: null, state: null, user: null, fromCoords: undefined, isLeader: true } satisfies UseStragglerReportingInput;
    const mounted = await mountHook(useStragglerReporting, input);
    await mounted.update(input);
    expect(reportStraggler).toHaveBeenCalledTimes(1);
    expect(reportStraggler).toHaveBeenCalledWith('team', 'peer', 900);
    await mounted.unmount();
  });
});

function completionInput(): UseGatheringCompletionInput {
  return {
    groupId: 'team', user: { id: 'leader', name: 'Leader', email: 'leader@example.test' },
    canEditItinerary: true, pendingLeaderTargetId: null,
    resolveCurrentNavigationSessionId: () => 'session', arrivalContext: 'current',
    mapMountedRef: { current: true }, arrivalContextRef: { current: 'current' },
    allScopedDestinations: [], completingDestIdsRef: { current: new Set() },
    remoteAutoCompleteDestIdsRef: { current: new Set() }, sessionEligibleMembers: [],
    activeDestinationArrivals: [], refreshLocalSnapshot: jest.fn(async () => true), t,
    routeDraft: { latestDestinations: () => null, setDestinations: jest.fn() },
    prevVisibleDestOrderRef: { current: [] }, startArrivalCardExit: jest.fn(),
    stopRemovedDestination: jest.fn(), navigationSessionState: { refresh: jest.fn(async () => null) },
    refresh: jest.fn(async () => true), loadGatheringWorkflow: jest.fn(async () => undefined),
    loadHistory: jest.fn(async () => undefined), members: [], navTargetId: null,
  };
}

const completionStop = { id: 'stop', title: 'Temple', coordinates: { latitude: 1, longitude: 2 }, order: 0, day: 1 };

describe('MapScreen gathering completion', () => {
  beforeEach(() => jest.clearAllMocks());

  it('releases the in-flight guard after failure and retries the same session', async () => {
    const input = completionInput();
    jest.mocked(enqueueJourneyCompletion).mockRejectedValueOnce(new Error('disk failed')).mockResolvedValueOnce(null);
    const mounted = await mountHook(useGatheringCompletion, input);
    await act(async () => { expect(await mounted.value.runCompleteGatheringStop(completionStop)).toBe(false); });
    expect(input.completingDestIdsRef.current.size).toBe(0);
    expect(input.stopRemovedDestination).not.toHaveBeenCalled();
    await act(async () => { expect(await mounted.value.runCompleteGatheringStop(completionStop)).toBe(true); });
    expect(enqueueJourneyCompletion).toHaveBeenLastCalledWith(expect.objectContaining({ groupId: 'team', destinationId: 'stop', navigationSessionId: 'session', force: true }));
    expect(input.startArrivalCardExit).toHaveBeenCalledWith(expect.objectContaining({ id: 'stop', closedAt: expect.any(String) }), 0);
    expect(input.stopRemovedDestination).toHaveBeenCalledWith('stop', 'session');
    expect(input.loadHistory).toHaveBeenCalledTimes(1);
    await mounted.unmount();
  });

  it('ignores completion after the arrival context changes', async () => {
    const pending = deferred<Awaited<ReturnType<typeof enqueueJourneyCompletion>>>();
    jest.mocked(enqueueJourneyCompletion).mockReturnValueOnce(pending.promise);
    const input = completionInput();
    const mounted = await mountHook(useGatheringCompletion, input);
    const result = mounted.value.runCompleteGatheringStop(completionStop);
    input.arrivalContextRef.current = 'another-team';
    await act(async () => { pending.resolve(null); expect(await result).toBe(false); });
    expect(input.refreshLocalSnapshot).not.toHaveBeenCalled();
    expect(input.startArrivalCardExit).not.toHaveBeenCalled();
    expect(input.completingDestIdsRef.current.size).toBe(0);
    await mounted.unmount();
  });

  it('does not submit a second completion while the first write is pending', async () => {
    const pending = deferred<Awaited<ReturnType<typeof enqueueJourneyCompletion>>>();
    jest.mocked(enqueueJourneyCompletion).mockReturnValueOnce(pending.promise);
    const input = completionInput();
    const mounted = await mountHook(useGatheringCompletion, input);
    const first = mounted.value.runCompleteGatheringStop(completionStop);
    expect(await mounted.value.runCompleteGatheringStop(completionStop)).toBe(false);
    expect(enqueueJourneyCompletion).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(null); await first; });
    await mounted.unmount();
  });

  it('does not complete when a local start has no resolved session yet', async () => {
    const input = { ...completionInput(), pendingLeaderTargetId: 'stop', resolveCurrentNavigationSessionId: () => null };
    const mounted = await mountHook(useGatheringCompletion, input);
    expect(await mounted.value.runCompleteGatheringStop(completionStop)).toBe(false);
    expect(enqueueJourneyCompletion).not.toHaveBeenCalled();
    await mounted.unmount();
  });
});

function presenceInput(): UseMemberPresenceInput {
  return {
    groupId: 'team', t, uiVisible: true,
    members: [{ userId: 'me', name: 'Old Name', role: 'follower', status: 'active', lastUpdated: '2026-10-22T00:00:00Z', solo: false }],
    user: { id: 'me', name: 'New Name', email: 'me@example.test', avatar: 'bird', avatarColor: '#123456' },
    activePoint: undefined, memberRoutes: {}, travelMode: 'walk', navTarget: undefined,
    activeDestinationArrivals: [], deviceCoordsAcceptedAtMs: null, myScopeId: undefined,
    sharingEnabled: true, handleSharingEnabledChange: jest.fn(async () => true),
  };
}

describe('MapScreen member presence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getNotificationPreferences).mockResolvedValue(DEFAULT_NOTIFICATION_PREFERENCES);
    jest.mocked(setNotificationPreferences).mockResolvedValue(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it('uses the current profile and rolls back optimistic Solo when persistence fails', async () => {
    const input = presenceInput();
    const pending = deferred<void>();
    jest.mocked(setSolo).mockReturnValueOnce(pending.promise);
    const mounted = await mountHook(useMemberPresence, input);
    expect(mounted.value.flock[0]).toMatchObject({ name: 'New Name', avatar: 'bird', avatarColor: '#123456', solo: false });
    let result!: Promise<boolean>;
    await act(async () => { result = mounted.value.applyPresenceMacroKind('solo'); });
    expect(mounted.value.mySoloActive).toBe(true);
    expect(mounted.value.flock[0].solo).toBe(true);
    // A failed request follows the existing rollback path through the real macro writer.
    jest.mocked(setNotificationPreferences).mockRejectedValueOnce(new Error('offline'));
    jest.mocked(setSolo).mockResolvedValueOnce(undefined);
    await act(async () => { pending.resolve(undefined); expect(await result).toBe(false); });
    expect(setSolo).toHaveBeenLastCalledWith('team', false);
    expect(mounted.value.mySoloActive).toBe(false);
    expect(mounted.value.myStatusKind).toBe('follow');
    await mounted.unmount();
  });

  it('clears the optimistic Solo override after the server confirms it', async () => {
    const input = presenceInput();
    jest.mocked(setSolo).mockResolvedValue(undefined);
    const mounted = await mountHook(useMemberPresence, input);
    await act(async () => { expect(await mounted.value.applyPresenceMacroKind('solo')).toBe(true); });
    expect(mounted.value.flock[0].solo).toBe(true);
    await mounted.update({ ...input, members: input.members.map(member => ({ ...member, solo: true })) });
    await mounted.update(input);
    expect(mounted.value.mySoloActive).toBe(false);
    expect(mounted.value.flock[0].solo).toBe(false);
    await mounted.unmount();
  });

  it('ignores notification preferences from an earlier account', async () => {
    const old = deferred<Awaited<ReturnType<typeof getNotificationPreferences>>>();
    jest.mocked(getNotificationPreferences).mockReturnValueOnce(old.promise).mockResolvedValueOnce(DEFAULT_NOTIFICATION_PREFERENCES);
    const input = { ...presenceInput(), sharingEnabled: false };
    const mounted = await mountHook(useMemberPresence, input);
    await mounted.update({ ...input, user: { id: 'next', name: 'Next', email: 'next@example.test' } });
    await act(async () => { old.resolve({ addGathering: false, leaderCommands: false, followerRequests: false, journey: false, arrival: false }); });
    expect(mounted.value.myStatusKind).toBe('follow');
    await mounted.unmount();
  });
});
