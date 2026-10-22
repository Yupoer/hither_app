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

jest.mock('react-native', () => ({ Alert: { alert: jest.fn() }, Share: { share: jest.fn() } }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('../api/client', () => ({
  fetchVisitedWaypoints: jest.fn(), leaveGroups: jest.fn(), reportStraggler: jest.fn(),
  saveOnboardingProfile: jest.fn(),
}));
jest.mock('../api/services/StoreService', () => ({ getStoreSnapshot: jest.fn() }));
jest.mock('../state/useLiveActivity', () => ({ clearLiveActivities: jest.fn() }));
jest.mock('../state/useStragglerAlerts', () => ({ useStragglerAlerts: jest.fn() }));
jest.mock('../featureTour', () => ({
  clearGroupFeatureTour: jest.fn(), clearAddPlaceTour: jest.fn(), clearRouteReorderTour: jest.fn(),
}));
jest.mock('../onboarding/sync', () => ({ markOnboardingReplayForHome: jest.fn() }));
jest.mock('../utils/activityLog', () => ({ logEvent: jest.fn(), logError: jest.fn() }));
jest.mock('../utils/haptics', () => ({ lightTap: jest.fn() }));
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
