import { useGatherCardExpansion } from '../screens/MapScreen/hooks/useGatherCardExpansion';
import { useMemberPresence, type UseMemberPresenceInput } from '../screens/MapScreen/hooks/useMemberPresence';
import { getNotificationPreferences, setNotificationPreferences, setSolo, saveOnboardingProfile, fetchVisitedWaypoints, leaveGroups, reportStraggler } from '../api/client';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../types';
import { useGatheringCompletion, type UseGatheringCompletionInput } from '../screens/MapScreen/hooks/useGatheringCompletion';
import { enqueueJourneyCompletion } from '../state/journeyCompletion';
import { notifyThisDeviceAutoComplete } from '../native/notifications';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useStoreEntitlements, type UseStoreEntitlementsInput } from '../screens/MapScreen/hooks/useStoreEntitlements';
import { useVisitHistory, type UseVisitHistoryInput } from '../screens/MapScreen/hooks/useVisitHistory';
import { useGroupActions, type UseGroupActionsInput } from '../screens/MapScreen/hooks/useGroupActions';
import { useAccountActions, type UseAccountActionsInput } from '../screens/MapScreen/hooks/useAccountActions';
import { useStragglerReporting, type UseStragglerReportingInput } from '../screens/MapScreen/hooks/useStragglerReporting';
import { getStoreSnapshot } from '../api/services/StoreService';
import { Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { clearLiveActivities } from '../state/useLiveActivity';
import { clearGroupFeatureTour, clearAddPlaceTour, clearRouteReorderTour } from '../featureTour';
import { markOnboardingReplayForHome } from '../onboarding/sync';
import { useStragglerAlerts } from '../state/useStragglerAlerts';

jest.mock('../state/journeyCompletion', () => ({ enqueueJourneyCompletion: jest.fn() }));
jest.mock('../native/notifications', () => ({ notifyThisDeviceAutoComplete: jest.fn(async () => undefined) }));
jest.mock('react-native', () => ({ AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) }, Alert: { alert: jest.fn() }, Share: { share: jest.fn() } }));
jest.mock('../api/supabase', () => ({ supabase: {
  channel: jest.fn(() => ({ on: jest.fn().mockReturnThis(), subscribe: jest.fn().mockReturnThis() })),
  removeChannel: jest.fn(),
} }));
jest.mock('../state/coreDataSync', () => ({}));
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
  function Harness({ input: next }: { input: I }) {
    value = hook(next);
    return value != null && typeof value === 'object' && 'lifecycle' in value
      && React.isValidElement(value.lifecycle) ? value.lifecycle : null;
  }
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

  it('keeps onboarding replay available when resetting account preferences offline', async () => {
    const offline = new Error('offline');
    jest.mocked(saveOnboardingProfile).mockRejectedValueOnce(offline);
    jest.mocked(markOnboardingReplayForHome).mockRejectedValueOnce(offline);
    jest.mocked(clearGroupFeatureTour).mockRejectedValueOnce(offline);
    jest.mocked(clearAddPlaceTour).mockRejectedValueOnce(offline);
    jest.mocked(clearRouteReorderTour).mockRejectedValueOnce(offline);
    const input: UseAccountActionsInput = {
      groupId: 'team', isLeader: false, leaveGroup: jest.fn(),
      navigation: { reset: jest.fn() } as unknown as UseAccountActionsInput['navigation'],
      reevaluateRouteTour: jest.fn(), setAddPlaceTourLocalDone: jest.fn(), signOut: jest.fn(),
      updateProfile: jest.fn().mockRejectedValue(offline),
      user: { id: 'me', name: 'Me', email: 'me@example.test', preferences: { groupFeatureTourCompleted: true } },
      voluntaryLeaveRef: { current: false }, t,
    };
    const mounted = await mountHook(useAccountActions, input);
    await act(async () => {
      mounted.value.confirmResetPrefs();
      await new Promise(resolve => setImmediate(resolve));
    });
    expect(saveOnboardingProfile).toHaveBeenCalledWith({});
    expect(markOnboardingReplayForHome).toHaveBeenCalledTimes(1);
    expect(clearRouteReorderTour).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'me' }));
    expect(input.reevaluateRouteTour).toHaveBeenCalledTimes(1);
    expect(input.setAddPlaceTourLocalDone).toHaveBeenCalledWith(false);
    expect(input.updateProfile).toHaveBeenCalledWith({ preferences: {
      groupFeatureTourCompleted: false, addPlaceTourCompleted: false, routeReorderTourCompleted: false,
    } });
    expect(Alert.alert).toHaveBeenCalledWith('settings.resetAllPrefs', 'settings.resetPrefsDone');
    expect(input.navigation.reset).not.toHaveBeenCalled();
    await mounted.unmount();
  });
});

function completionInput(): UseGatheringCompletionInput {
  return {
    groupId: 'team', user: { id: 'leader', name: 'Leader', email: 'leader@example.test' },
    canEditItinerary: true, pendingLeaderTargetId: null,
    resolveCurrentNavigationSessionId: () => 'session', arrivalContext: 'current',
    mapMountedRef: { current: true }, arrivalContextRef: { current: 'current' },
    allScopedDestinations: [completionStop], completingDestIdsRef: { current: new Set() },
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
const completionOperation: NonNullable<Awaited<ReturnType<typeof enqueueJourneyCompletion>>> = {
  id: 'complete-operation', groupId: 'team', entityType: 'itinerary', entityId: 'team',
  entityVersion: 1, operationType: 'complete_destination', payload: { destinationId: 'stop', sessionId: 'session' },
  createdAt: 1, updatedAt: 1, status: 'pending', attempts: 0, nextAttemptAt: 0, conflictResult: null,
};

function manualCompletionInput(): UseGatheringCompletionInput {
  return { ...completionInput(), sessionEligibleMembers: [
    { userId: 'leader', name: 'Leader', role: 'leader', status: 'active', lastUpdated: '2026-10-23T00:00:00Z' },
    { userId: 'member', name: 'Member', role: 'follower', status: 'active', lastUpdated: '2026-10-23T00:00:00Z' },
  ] };
}

describe('MapScreen gathering completion', () => {
  beforeEach(() => jest.clearAllMocks());

  it('completes the active scoped stop once when the final committed arrival is rendered', async () => {
    const stop = { ...completionStop, subgroupId: 'flock' };
    const otherStop = { ...completionStop, id: 'other-stop' };
    let sessionId: string | null = 'session';
    const input: UseGatheringCompletionInput = {
      ...manualCompletionInput(), allScopedDestinations: [otherStop, stop], navTargetId: 'stop',
      resolveCurrentNavigationSessionId: () => sessionId,
      refreshLocalSnapshot: jest.fn(async () => { sessionId = null; return true; }),
      sessionEligibleMembers: [
        ...manualCompletionInput().sessionEligibleMembers.map(member => ({ ...member, subgroupId: 'flock' })),
        { userId: 'outside', name: 'Outside', role: 'follower', status: 'active', lastUpdated: '2026-10-23T00:00:00Z' },
      ],
      activeDestinationArrivals: [
        { id: 'leader-arrival', groupId: 'team', destinationId: 'stop', userId: 'leader', arrivedAt: '2026-10-23T00:00:00Z', source: 'manual', markedBy: 'leader' },
        { id: 'elsewhere', groupId: 'team', destinationId: 'other-stop', userId: 'member', arrivedAt: '2026-10-23T00:00:00Z', source: 'manual', markedBy: 'member' },
      ],
      routeDraft: { latestDestinations: () => [otherStop, stop], setDestinations: jest.fn() },
      prevVisibleDestOrderRef: { current: ['other-stop', 'stop'] },
    };
    const pending = deferred<Awaited<ReturnType<typeof enqueueJourneyCompletion>>>();
    jest.mocked(enqueueJourneyCompletion).mockReturnValueOnce(pending.promise);
    const mounted = await mountHook(useGatheringCompletion, input);
    expect(enqueueJourneyCompletion).not.toHaveBeenCalled();
    expect(input.stopRemovedDestination).not.toHaveBeenCalled();
    const finalArrivals = [...input.activeDestinationArrivals,
      { id: 'member-arrival', groupId: 'team', destinationId: 'stop', userId: 'member', arrivedAt: '2026-10-23T00:01:00Z', source: 'manual', markedBy: 'member' } satisfies UseGatheringCompletionInput['activeDestinationArrivals'][number],
    ];
    await mounted.update({ ...input, activeDestinationArrivals: finalArrivals });
    expect(enqueueJourneyCompletion).toHaveBeenCalledTimes(1);
    expect(enqueueJourneyCompletion).toHaveBeenCalledWith(expect.objectContaining({
      groupId: 'team', destinationId: 'stop', navigationSessionId: 'session',
      scopeSubgroupId: 'flock', navigationMemberIds: ['leader', 'member'],
      arrivedMemberIds: ['leader', 'member'], force: false,
    }));
    await mounted.update({ ...input, activeDestinationArrivals: [...finalArrivals] });
    expect(enqueueJourneyCompletion).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(completionOperation); });
    expect(input.routeDraft.setDestinations).toHaveBeenCalledWith([
      otherStop, expect.objectContaining({ id: 'stop', closedAt: expect.any(String) }),
    ]);
    expect(input.startArrivalCardExit).toHaveBeenCalledWith(expect.objectContaining({ id: 'stop', closedAt: expect.any(String) }), 1);
    expect(input.stopRemovedDestination).toHaveBeenCalledWith('stop', 'session');
    expect(input.loadHistory).toHaveBeenCalledTimes(1);
    expect(notifyThisDeviceAutoComplete).toHaveBeenCalledTimes(1);
    expect(notifyThisDeviceAutoComplete).toHaveBeenCalledWith({
      title: 'gathering.autoCompleteTitle', body: 'gathering.autoCompleteBody',
      data: { kind: 'gathering_auto_complete', destinationId: 'stop' },
    });
    const closedStop = { ...stop, closedAt: '2026-10-23T00:01:00Z' };
    await act(async () => { mounted.value.promptCompleteAfterArrival(closedStop); });
    await mounted.update({ ...input, allScopedDestinations: [otherStop, closedStop], activeDestinationArrivals: finalArrivals });
    expect(enqueueJourneyCompletion).toHaveBeenCalledTimes(1);
    expect(notifyThisDeviceAutoComplete).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
    await mounted.unmount();
  });

  it('keeps a remotely completed roster open after enqueue failure and retries on the next committed snapshot', async () => {
    const input: UseGatheringCompletionInput = {
      ...manualCompletionInput(), navTargetId: 'stop',
      activeDestinationArrivals: ['leader', 'member'].map(userId => ({
        id: `${userId}-arrival`, groupId: 'team', destinationId: 'stop', userId,
        arrivedAt: '2026-10-23T00:00:00Z', source: 'manual', markedBy: userId,
      })),
    };
    jest.mocked(enqueueJourneyCompletion).mockRejectedValueOnce(new Error('disk failed')).mockResolvedValueOnce(completionOperation);
    const mounted = await mountHook(useGatheringCompletion, input);
    expect(enqueueJourneyCompletion).toHaveBeenCalledTimes(1);
    expect(Alert.alert).toHaveBeenCalledWith('map.setFailedTitle', expect.any(String));
    expect(input.refreshLocalSnapshot).not.toHaveBeenCalled();
    expect(input.startArrivalCardExit).not.toHaveBeenCalled();
    expect(input.stopRemovedDestination).not.toHaveBeenCalled();
    expect(input.loadHistory).not.toHaveBeenCalled();
    expect(notifyThisDeviceAutoComplete).not.toHaveBeenCalled();
    await mounted.update({ ...input, activeDestinationArrivals: [...input.activeDestinationArrivals] });
    expect(enqueueJourneyCompletion).toHaveBeenCalledTimes(2);
    expect(enqueueJourneyCompletion).toHaveBeenLastCalledWith(expect.objectContaining({ navigationSessionId: 'session', force: false }));
    expect(input.stopRemovedDestination).toHaveBeenCalledWith('stop', 'session');
    expect(input.loadHistory).toHaveBeenCalledTimes(1);
    expect(notifyThisDeviceAutoComplete).toHaveBeenCalledTimes(1);
    await mounted.unmount();
  });

  it('shows the committed partial-arrival count and confirms only those arrival rows', async () => {
    const translate = jest.fn((key: string) => key);
    const input: UseGatheringCompletionInput = {
      ...manualCompletionInput(), t: translate,
      activeDestinationArrivals: [
        { id: 'member-arrival', groupId: 'team', destinationId: 'stop', userId: 'member', arrivedAt: '2026-10-23T00:00:00Z', source: 'manual', markedBy: 'member' },
        { id: 'leader-elsewhere', groupId: 'team', destinationId: 'other-stop', userId: 'leader', arrivedAt: '2026-10-23T00:00:00Z', source: 'manual', markedBy: 'leader' },
      ],
    };
    jest.mocked(enqueueJourneyCompletion).mockResolvedValueOnce(completionOperation);
    const mounted = await mountHook(useGatheringCompletion, input);
    mounted.value.promptCompleteAfterArrival(completionStop);
    expect(translate).toHaveBeenCalledWith('gathering.completeMissingMessage', { arrived: '1', total: '2' });
    expect(enqueueJourneyCompletion).not.toHaveBeenCalled();
    await act(async () => { jest.mocked(Alert.alert).mock.calls[0][2]?.[1]?.onPress?.(); });
    expect(enqueueJourneyCompletion).toHaveBeenCalledWith(expect.objectContaining({
      destinationId: 'stop', navigationSessionId: 'session', force: true,
      arrivedMemberIds: ['member'], navigationMemberIds: ['leader', 'member'],
    }));
    expect(input.stopRemovedDestination).toHaveBeenCalledWith('stop', 'session');
    expect(input.loadHistory).toHaveBeenCalledTimes(1);
    expect(notifyThisDeviceAutoComplete).not.toHaveBeenCalled();
    await mounted.unmount();
  });

  it('releases the in-flight guard after failure and retries the same session', async () => {
    const input = completionInput();
    jest.mocked(enqueueJourneyCompletion).mockRejectedValueOnce(new Error('disk failed')).mockResolvedValueOnce(completionOperation);
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

  it('keeps the stop open when forced completion is not durably enqueued', async () => {
    const input = completionInput();
    jest.mocked(enqueueJourneyCompletion).mockResolvedValueOnce(null);
    const mounted = await mountHook(useGatheringCompletion, input);
    expect(await mounted.value.runCompleteGatheringStop(completionStop)).toBe(false);
    expect(input.refreshLocalSnapshot).not.toHaveBeenCalled();
    expect(input.routeDraft.setDestinations).not.toHaveBeenCalled();
    expect(input.startArrivalCardExit).not.toHaveBeenCalled();
    expect(input.stopRemovedDestination).not.toHaveBeenCalled();
    expect(input.loadHistory).not.toHaveBeenCalled();
    expect(input.completingDestIdsRef.current.size).toBe(0);
    await mounted.unmount();
  });

  it('asks for confirmation with no arrivals and cancellation leaves everything open', async () => {
    const input = manualCompletionInput();
    const mounted = await mountHook(useGatheringCompletion, input);
    mounted.value.promptCompleteAfterArrival(completionStop);
    expect(Alert.alert).toHaveBeenCalledWith('gathering.completeMissingTitle', 'gathering.completeMissingMessage', [
      expect.objectContaining({ text: 'common.cancel', style: 'cancel' }),
      expect.objectContaining({ text: 'gathering.completeConfirm', style: 'destructive' }),
    ]);
    const cancel = jest.mocked(Alert.alert).mock.calls[0][2]?.[0];
    cancel?.onPress?.();
    expect(enqueueJourneyCompletion).not.toHaveBeenCalled();
    expect(input.stopRemovedDestination).not.toHaveBeenCalled();
    await mounted.unmount();
  });

  it('confirms forced completion without inventing personal arrivals', async () => {
    const input = manualCompletionInput();
    jest.mocked(enqueueJourneyCompletion).mockResolvedValueOnce(completionOperation);
    const mounted = await mountHook(useGatheringCompletion, input);
    mounted.value.promptCompleteAfterArrival(completionStop);
    await act(async () => { jest.mocked(Alert.alert).mock.calls[0][2]?.[1]?.onPress?.(); });
    expect(enqueueJourneyCompletion).toHaveBeenCalledWith(expect.objectContaining({
      destinationId: 'stop', navigationSessionId: 'session', force: true,
      arrivedMemberIds: [], navigationMemberIds: ['leader', 'member'],
    }));
    expect(input.stopRemovedDestination).toHaveBeenCalledWith('stop', 'session');
    await mounted.unmount();
  });

  it('does not open a completion prompt until Start has a real session', async () => {
    const input = { ...manualCompletionInput(), pendingLeaderTargetId: 'stop', resolveCurrentNavigationSessionId: () => null };
    const mounted = await mountHook(useGatheringCompletion, input);
    mounted.value.promptCompleteAfterArrival(completionStop);
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(enqueueJourneyCompletion).not.toHaveBeenCalled();
    await mounted.unmount();
  });

  it.each(['destination', 'snapshot'])('reconciles a stop already closed in the %s without a session', async source => {
    const closedStop = { ...completionStop, closedAt: '2026-10-23T00:00:00Z' };
    const input = { ...manualCompletionInput(), resolveCurrentNavigationSessionId: () => null,
      allScopedDestinations: [closedStop] };
    const mounted = await mountHook(useGatheringCompletion, input);
    await act(async () => {
      mounted.value.promptCompleteAfterArrival(source === 'destination' ? closedStop : completionStop);
    });
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(enqueueJourneyCompletion).not.toHaveBeenCalled();
    expect(input.startArrivalCardExit).toHaveBeenCalledWith(expect.objectContaining({ id: 'stop', closedAt: expect.any(String) }), 0);
    expect(input.stopRemovedDestination).toHaveBeenCalledWith('stop', null);
    expect(input.loadHistory).toHaveBeenCalledTimes(1);
    await mounted.unmount();
  });

  it('blocks manual completion of an open stop without a session', async () => {
    const input = { ...manualCompletionInput(), resolveCurrentNavigationSessionId: () => null };
    const mounted = await mountHook(useGatheringCompletion, input);
    await act(async () => {
      mounted.value.promptCompleteAfterArrival(completionStop);
      expect(await mounted.value.runCompleteGatheringStop(completionStop)).toBe(false);
    });
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(enqueueJourneyCompletion).not.toHaveBeenCalled();
    expect(input.startArrivalCardExit).not.toHaveBeenCalled();
    expect(input.stopRemovedDestination).not.toHaveBeenCalled();
    expect(input.loadHistory).not.toHaveBeenCalled();
    await mounted.unmount();
  });

  it.each([
    ['session', { resolveCurrentNavigationSessionId: () => 'new-session' }],
    ['ended session', { resolveCurrentNavigationSessionId: () => null }],
    ['group', { groupId: 'other-team' }],
    ['actor', { user: { id: 'other-leader', name: 'Other', email: 'other@example.test' } }],
    ['permission', { canEditItinerary: false }],
    ['arrival context', { arrivalContext: 'other-scope' }],
    ['destination scope', { allScopedDestinations: [{ ...completionStop, subgroupId: 'other-scope' }] }],
    ['removed destination', { allScopedDestinations: [] }],
  ] satisfies [string, Partial<UseGatheringCompletionInput>][])(
    'rejects an old dialog after the %s changes', async (_reason, changed) => {
      const input = manualCompletionInput();
      const mounted = await mountHook(useGatheringCompletion, input);
      mounted.value.promptCompleteAfterArrival(completionStop);
      const confirm = jest.mocked(Alert.alert).mock.calls[0][2]?.[1]?.onPress;
      expect(confirm).toBeDefined();
      await mounted.update({ ...input, ...changed });
      await act(async () => { confirm?.(); });
      expect(enqueueJourneyCompletion).not.toHaveBeenCalled();
      expect(input.routeDraft.setDestinations).not.toHaveBeenCalled();
      expect(input.startArrivalCardExit).not.toHaveBeenCalled();
      expect(input.stopRemovedDestination).not.toHaveBeenCalled();
      await mounted.unmount();
    },
  );

  it('uses the original session after local refresh removes its resolver identity', async () => {
    let sessionId: string | null = 'session';
    const input = { ...completionInput(), resolveCurrentNavigationSessionId: () => sessionId,
      refreshLocalSnapshot: jest.fn(async () => { sessionId = null; return true; }) };
    jest.mocked(enqueueJourneyCompletion).mockResolvedValueOnce(completionOperation);
    const mounted = await mountHook(useGatheringCompletion, input);
    await act(async () => { expect(await mounted.value.runCompleteGatheringStop(completionStop)).toBe(true); });
    expect(input.stopRemovedDestination).toHaveBeenCalledWith('stop', 'session');
    await mounted.unmount();
  });

  it('does not apply old completion effects to a newer session while the write is pending', async () => {
    const pending = deferred<Awaited<ReturnType<typeof enqueueJourneyCompletion>>>();
    jest.mocked(enqueueJourneyCompletion).mockReturnValueOnce(pending.promise);
    const input = completionInput();
    const mounted = await mountHook(useGatheringCompletion, input);
    const completion = mounted.value.runCompleteGatheringStop(completionStop);
    await mounted.update({ ...input, resolveCurrentNavigationSessionId: () => 'new-session' });
    await act(async () => { pending.resolve(completionOperation); expect(await completion).toBe(false); });
    expect(input.refreshLocalSnapshot).not.toHaveBeenCalled();
    expect(input.stopRemovedDestination).not.toHaveBeenCalled();
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
  it('keeps independent nested jobs with the same generation isolated across identity changes', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
    const old = deferred<Awaited<ReturnType<typeof getNotificationPreferences>>>();
    jest.mocked(getNotificationPreferences).mockReturnValueOnce(old.promise).mockResolvedValueOnce(DEFAULT_NOTIFICATION_PREFERENCES);
    let expansion!: ReturnType<typeof useGatherCardExpansion>;
    let presence!: ReturnType<typeof useMemberPresence>;
    const input = { ...presenceInput(), sharingEnabled: false };
    function Combined({ expanded, account }: { expanded: boolean; account: UseMemberPresenceInput }) {
      expansion = useGatherCardExpansion(expanded);
      presence = useMemberPresence(account);
      return React.createElement(React.Fragment, null, expansion.lifecycle, presence.lifecycle);
    }
    let renderer!: ReactTestRenderer;
    try {
      await act(async () => { renderer = create(React.createElement(Combined, { expanded: false, account: input })); });
      act(() => expansion.expandCard('tour-stop'));
      expect(jest.getTimerCount()).toBe(1);
      await act(async () => { renderer.update(React.createElement(Combined, {
        expanded: true, account: { ...input, user: { id: 'next', name: 'Next', email: 'next@example.test' } },
      })); });
      expect(jest.getTimerCount()).toBe(0);
      expect(getNotificationPreferences).toHaveBeenCalledTimes(2);
      await act(async () => { old.resolve({ addGathering: false, leaderCommands: false, followerRequests: false, journey: false, arrival: false }); });
      expect(presence.myStatusKind).toBe('follow');
    } finally {
      await act(async () => { renderer.unmount(); });
      jest.useRealTimers();
    }
  });

});

it('refreshes open history on history-only events, reconnect and foreground, and unsubscribes on close', async () => {
  jest.useFakeTimers();
  const { supabase } = require('../api/supabase');
  const { AppState } = require('react-native');
  jest.mocked(fetchVisitedWaypoints).mockResolvedValue([]);
  const input: UseVisitHistoryInput = { allScopedDestinations: [], arrivalOperations: [], destinationArrivals: [],
    group: null, groupId: 'team', isLeader: true, members: [], overlay: 'history',
    routeDepartureDate: undefined, routeTripDays: undefined,
    user: { id: 'leader', name: 'Leader', email: 'leader@example.test' } };
  const mounted = await mountHook(useVisitHistory, input);
  const channel = supabase.channel.mock.results.at(-1).value;
  const event = channel.on.mock.calls.find((call: any[]) => call[1].table === 'navigation_session_history')[2];
  const subscribed = channel.subscribe.mock.calls[0][0];
  const foreground = AppState.addEventListener.mock.calls.at(-1)[1];
  expect(channel.on.mock.calls.map((call: any[]) => call[1].table)).toEqual(['visited_waypoints', 'navigation_session_history']);
  const before = jest.mocked(fetchVisitedWaypoints).mock.calls.length;
  for (const trigger of [event, () => subscribed('SUBSCRIBED'), () => foreground('active')]) {
    await act(async () => { trigger(); jest.advanceTimersByTime(300); });
  }
  expect(fetchVisitedWaypoints).toHaveBeenCalledTimes(before + 3);
  await mounted.update({ ...input, overlay: null });
  expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
  const callsAfterClose = jest.mocked(fetchVisitedWaypoints).mock.calls.length;
  await act(async () => { jest.advanceTimersByTime(60_000); });
  expect(fetchVisitedWaypoints).toHaveBeenCalledTimes(callsAfterClose);
  await mounted.unmount();
  jest.useRealTimers();
});

it('a false ACK removes stale visited history only for its original session', async () => {
  const receipt = { id: 'receipt', actorId: 'me', groupId: 'team', entityId: 'stop', operationType: 'record_arrival',
    status: 'acked', payload: { actorId: 'me', userId: 'me', effectiveArrival: {
      sessionId: 'old', destinationId: 'stop', userId: 'me', arrived: false, arrivedAt: null,
      source: 'leader_correction', markedBy: 'leader', updatedAt: '2026-10-23T01:00:00Z',
    } } } as unknown as UseVisitHistoryInput['arrivalOperations'][number];
  const visited = { id: 'visit', userId: 'me', destinationId: 'stop', navigationSessionId: 'old',
    arrivedAt: '2026-10-23T00:00:00Z', name: 'Temple', coordinates: { latitude: 25, longitude: 121 } };
  jest.mocked(fetchVisitedWaypoints).mockResolvedValue([visited]);
  const input: UseVisitHistoryInput = { allScopedDestinations: [], arrivalOperations: [receipt], destinationArrivals: [],
    group: null, groupId: 'team', isLeader: false, members: [], overlay: 'history',
    routeDepartureDate: undefined, routeTripDays: undefined,
    user: { id: 'me', name: 'Me', email: 'me@example.test' } };
  const mounted = await mountHook(useVisitHistory, input);
  expect(mounted.value.historyGroups).toEqual([]);
  jest.mocked(fetchVisitedWaypoints).mockResolvedValue([{ ...visited, navigationSessionId: 'new' }]);
  await act(async () => { await mounted.value.loadHistory(); });
  expect(mounted.value.historyGroups.flatMap(day => day.items)).toEqual([expect.objectContaining({ navigationSessionId: 'new' })]);
  await mounted.unmount();
});
