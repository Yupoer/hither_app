import * as Crypto from 'expo-crypto';
import { useState, useMemo, useEffect, useCallback, useRef, RefObject } from 'react';
import { Alert, type ScrollView } from 'react-native';
import { getOperationErrorMessage } from '../../../utils/operationError';
import { distanceMeters } from '../../../utils/geo';
import { followCarouselIndexAfterPromote } from '../../../utils/journeyStartCarouselIdentity';
import type { Coordinates, Destination, GroupState, JourneyStatus } from '../../../types';
import type { NavigationSession } from '../../../types/navigation';
import type { GroupMapHandle } from '../../../components/GroupMap';
import { presentExternalMapsChooser } from '../../../native/externalNavigation';
import type { TravelMode } from '../../../native/maps';
import type { ActiveGatheringState } from '../../../types/coreData';
import { deriveActiveGatheringFromGroupState } from '../../../utils/activeGatheringState';
import {
  enqueueLeaderGatheringEnd,
  enqueueLeaderGatheringStart,
  enqueueLeaderGatheringSwitch,
  flushCoreOperationOutbox,
  getCoreOperationOutbox,
} from '../../../state/coreDataSync';
import { logEvent } from '../../../utils/activityLog';

interface TeamCommandIntent {
  sequence: number;
  action: 'start' | 'end';
  destination: Destination;
  index: number;
}

interface UseJourneyNavigationParams {
  state: GroupState | null;
  groupId: string | null | undefined;
  isLeader: boolean;
  destinations: Destination[];
  navigationDestinations?: Destination[];
  reorderDestinations?: Destination[];
  selectedDestination: Destination | undefined;
  fromCoords: Coordinates | undefined;
  refresh: () => void;
  t: (key: string, params?: Record<string, any>) => string;
  mapRef: RefObject<GroupMapHandle | null>;
  carouselRef: RefObject<ScrollView | null>;
  setSelectedIndex: (index: number) => void;
  /** Undefined means legacy data is still hydrating; null means no active session. */
  navigationSession?: NavigationSession | null;
  startSession?: (
    destinationId: string,
    requestId: string,
    replaceExisting?: boolean,
  ) => Promise<NavigationSession>;
  /** Kept for callers that still pass the old terminal handler. */
  cancelSession?: () => Promise<NavigationSession | null>;
  /** Re-read the server session when a start response was ambiguous. */
  refreshNavigationSession?: () => Promise<NavigationSession | null>;
  createRequestId?: () => string;
  reorderForNavigation?: (
    updates: { id: string; position: number; day: number | null }[],
  ) => Promise<boolean>;
  travelMode?: TravelMode;
  onOptimisticGathering?: (gathering: ActiveGatheringState) => void;
  /**
   * Operator local confirm after start/switch session succeeds (ticket 02).
   * Client-triggered — does not rely on DB update payload for sender.
   */
  onOperatorStartConfirm?: (destination: Destination, eventId: string) => void;
  onOperatorPauseConfirm?: (destination: Destination, eventId: string) => void;
  hasPendingTeamOperation?: boolean;
}

export function useJourneyNavigation({
  state,
  groupId,
  isLeader,
  destinations,
  navigationDestinations = destinations,
  reorderDestinations = destinations,
  selectedDestination,
  fromCoords,
  refresh: _refresh,
  t,
  mapRef,
  setSelectedIndex,
  navigationSession,
  startSession,
  cancelSession,
  refreshNavigationSession,
  createRequestId = Crypto.randomUUID,
  reorderForNavigation,
  travelMode = 'walk',
  onOptimisticGathering,
  onOperatorStartConfirm,
  onOperatorPauseConfirm,
  hasPendingTeamOperation,
}: UseJourneyNavigationParams) {
  const legacyMode = navigationSession === undefined;
  const legacySharedTargetId = legacyMode && state?.group.journeyStatus === 'going'
    ? state.group.activeDestinationId ?? null
    : null;
  const authoritativeSharedTargetId = navigationSession?.status === 'active'
    ? navigationSession.destinationId
    : legacySharedTargetId;

  // `undefined` means no local override; null is an optimistic End. This is
  // intentionally separate from the server session so Realtime latency cannot
  // turn the newest button tap back into the previous visual state.
  const [optimisticTeamTargetId, setOptimisticTeamTargetId] = useState<string | null | undefined>(undefined);
  const [localTargetId, setLocalTargetId] = useState<string | null>(null);
  const [pendingLeaderTargetId, setPendingLeaderTargetId] = useState<string | null>(null);
  const [pendingLeaderStop, setPendingLeaderStop] = useState(false);
  const [journeyBusy, setJourneyBusy] = useState(false);
  const lastFollowerCenterKeyRef = useRef<string | null>(null);
  const requestRef = useRef<{ destinationId: string; requestId: string } | null>(null);
  const desiredTeamIntentRef = useRef<Array<() => Promise<void>>>([]);
  const teamCommandRunnerRef = useRef<Promise<void> | null>(null);
  const teamCommandSequenceRef = useRef(0);
  const pendingCarouselTargetIdRef = useRef<string | null>(null);
  const gatheringStatesRef = useRef(new Map<string, ActiveGatheringState>());
  const currentGroupRef = useRef(groupId);
  currentGroupRef.current = groupId;
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  useEffect(() => {
    setOptimisticTeamTargetId(undefined);
    setLocalTargetId(null);
    setPendingLeaderTargetId(null);
    setPendingLeaderStop(false);
    setJourneyBusy(false);
    pendingStartRef.current = null;
    requestRef.current = null;
  }, [groupId]);
  const serverOrStartedSessionRef = useRef(Boolean(authoritativeSharedTargetId));
  const pendingStartRef = useRef<{
    operationId: string;
    base: ActiveGatheringState;
  } | null>(null);

  // Realtime/retry may confirm a start after the original request lost its response.
  useEffect(() => {
    const pending = requestRef.current;
    if (!pendingStartRef.current || !pending || navigationSession?.status !== 'active'
      || navigationSession.destinationId !== pending.destinationId
      || navigationSession.requestId !== pending.requestId) return;
    const destination = navigationDestinations.find((item) => item.id === pending.destinationId);
    if (!destination) return;
    requestRef.current = null;
    pendingStartRef.current = null;
    serverOrStartedSessionRef.current = true;
    onOperatorStartConfirm?.(destination, `start:${groupId}:${pending.requestId}`);
    void flushCoreOperationOutbox().catch(() => undefined);
  }, [groupId, navigationSession, navigationDestinations, onOperatorStartConfirm]);

  const sharedTargetId = optimisticTeamTargetId !== undefined
    ? optimisticTeamTargetId
    : authoritativeSharedTargetId;

  useEffect(() => {
    if (groupId && !gatheringStatesRef.current.has(groupId) && state) {
      gatheringStatesRef.current.set(groupId, deriveActiveGatheringFromGroupState(state, 0));
    }
  }, [state, groupId]);

  useEffect(() => {
    if (hasPendingTeamOperation !== false || !state || !groupId || teamCommandRunnerRef.current) return;
    gatheringStatesRef.current.set(groupId, deriveActiveGatheringFromGroupState(state, 0));
    setOptimisticTeamTargetId(undefined);
  }, [state, groupId, hasPendingTeamOperation]);

  useEffect(() => {
    serverOrStartedSessionRef.current = Boolean(authoritativeSharedTargetId);
    const override = optimisticTeamTargetId;
    if (override === undefined) return;
    if (override === authoritativeSharedTargetId) {
      setOptimisticTeamTargetId(undefined);
    }
  }, [authoritativeSharedTargetId, optimisticTeamTargetId]);

  useEffect(() => {
    if (sharedTargetId && pendingLeaderTargetId === sharedTargetId) {
      setPendingLeaderTargetId(null);
    }
    if (sharedTargetId) setPendingLeaderStop(false);
  }, [pendingLeaderTargetId, sharedTargetId]);

  // Shared flock session owns the target for leaders and members. During a
  // local optimistic End, `sharedTargetId` is null and the route disappears
  // immediately instead of waiting for the terminal RPC.
  const navTargetId = sharedTargetId ?? (isLeader ? pendingLeaderTargetId : localTargetId);
  const navTarget = useMemo<Destination | undefined>(() => {
    if (!navTargetId) return undefined;
    const fromList = navigationDestinations.find((destination) => destination.id === navTargetId);
    if (fromList) return fromList;
    if (
      navigationSession?.status === 'active'
      && navigationSession.destinationId === navTargetId
    ) {
      return {
        id: navigationSession.destinationId,
        title: navigationSession.destination.name,
        order: 0,
        day: 1,
        coordinates: navigationSession.destination.coordinates,
      };
    }
    return undefined;
  }, [navTargetId, navigationDestinations, navigationSession]);
  const journeyGoing = !pendingLeaderStop && Boolean(navTargetId);
  const journeyStatus: JourneyStatus = journeyGoing ? 'going' : 'paused';
  const journeyActive = journeyGoing && Boolean(navTarget);
  const activePoint = navTarget ?? selectedDestination;
  const numericDistance = fromCoords && navTarget
    ? distanceMeters(fromCoords, navTarget.coordinates)
    : undefined;

  /** External map control: chooser (Google / Apple / cancel) then open provider. */
  const openExternalNavigation = useCallback(
    (dest: Destination) => {
      presentExternalMapsChooser(dest, travelMode, {
        title: t('map.openExternalNavigation'),
        googleLabel: t('map.googleMaps'),
        appleLabel: t('map.appleMaps'),
        cancelLabel: t('common.cancel'),
        openFailedTitle: t('map.setFailedTitle'),
        openFailedMessage: t('map.externalMapsOpenFailed'),
      });
    },
    [t, travelMode],
  );

  /** @deprecated Use openExternalNavigation — kept as alias for gradual call-site migration. */
  const openInAppleMaps = openExternalNavigation;

  const startLocalRoutePlan = useCallback(
    (dest: Destination, index: number) => {
      setLocalTargetId(dest.id);
      setSelectedIndex(index);
      mapRef.current?.centerOn(dest.coordinates, { animated: false });
    },
    [mapRef, setSelectedIndex],
  );

  const runTeamEnd = useCallback(async (intent: TeamCommandIntent): Promise<void> => {
    if (!groupId) return;
    const isCurrent = () => mountedRef.current && currentGroupRef.current === groupId;
    const baseState = gatheringStatesRef.current.get(groupId)
      ?? (state ? deriveActiveGatheringFromGroupState(state, 0) : undefined);
    if (isCurrent()) setJourneyBusy(true);
    try {
      const operationId = createRequestId();
      const result = await enqueueLeaderGatheringEnd(groupId, { baseState, groupState: state,
        operationId, flushImmediately: false });
      gatheringStatesRef.current.set(groupId, result.local);
      if (!isCurrent()) { void flushCoreOperationOutbox().catch(() => undefined); return; }
      pendingStartRef.current = null;
      requestRef.current = null;
      onOptimisticGathering?.(result.local);
      setOptimisticTeamTargetId(null);
      // The durable operation owns both the gathering and navigation-session
      // transition. No second online-only cancel can race it.
      void flushCoreOperationOutbox().then(async () => {
        if (!isCurrent()) return;
        // Confirm only an accepted current command. Do not replay an old Pause
        // sound when a later Start is already queued, or while still offline.
        if (onOperatorPauseConfirm) {
          const pending = await getCoreOperationOutbox().getOperation(operationId);
          if (!pending && isCurrent() && teamCommandSequenceRef.current === intent.sequence) {
            onOperatorPauseConfirm(intent.destination, `pause:${groupId}:${operationId}`);
          }
        }
        if (!isCurrent()) return;
        _refresh();
        return refreshNavigationSession?.();
      }).catch(() => undefined);
    } catch (error) {
      if (!isCurrent()) return;
      setOptimisticTeamTargetId(undefined);
      Alert.alert(t('map.setFailedTitle'), getOperationErrorMessage(error));
      logEvent('nav_end_failed', { destId: intent.destination.id });
    } finally {
      if (isCurrent()) {
        setPendingLeaderStop(false);
        setPendingLeaderTargetId(null);
        setJourneyBusy(false);
      }
    }
  }, [groupId, state, onOptimisticGathering, onOperatorPauseConfirm, createRequestId, _refresh, refreshNavigationSession, t]);

  const runTeamStart = useCallback(async (intent: TeamCommandIntent): Promise<void> => {
    if (!groupId) return;
    const isCurrent = () => mountedRef.current && currentGroupRef.current === groupId;
    const { destination: dest, index } = intent;
    if (isCurrent()) { setJourneyBusy(true); setPendingLeaderStop(false); }
    try {
      const baseState = gatheringStatesRef.current.get(groupId)
        ?? (state ? deriveActiveGatheringFromGroupState(state, 0) : undefined);
      const switching = Boolean(baseState?.activeDestinationId && baseState.activeDestinationId !== dest.id);
      const operationId = createRequestId();
      const options = { baseState, groupState: state, activeDestinationId: dest.id, operationId,
        flushImmediately: false };
      const enqueued = switching
        ? await enqueueLeaderGatheringSwitch(groupId, options)
        : await enqueueLeaderGatheringStart(groupId, options);
      gatheringStatesRef.current.set(groupId, enqueued.local);
      if (!isCurrent()) { void flushCoreOperationOutbox().catch(() => undefined); return; }
      pendingStartRef.current = { operationId: enqueued.operationId, base: enqueued.base };
      requestRef.current = { destinationId: dest.id, requestId: enqueued.operationId };
      onOptimisticGathering?.(enqueued.local);
      setOptimisticTeamTargetId(dest.id);
      mapRef.current?.centerOn(dest.coordinates, { animated: false });
      const currentIndex = navigationDestinations.findIndex(item => item.id === dest.id);
      setSelectedIndex(currentIndex >= 0 ? currentIndex : index);
      // Automatic carousel promotion is display-only. A separate reorder before
      // Start would create a partial commit and poison the FIFO's base version.
      pendingCarouselTargetIdRef.current = null;
      void flushCoreOperationOutbox().then(() => {
        if (!isCurrent()) return;
        _refresh();
        return refreshNavigationSession?.();
      }).catch(() => undefined);
    } catch (error) {
      if (!isCurrent()) return;
      setOptimisticTeamTargetId(undefined);
      Alert.alert(t('map.setFailedTitle'), getOperationErrorMessage(error));
      logEvent('nav_start_failed', { destId: dest.id, sequence: intent.sequence });
    } finally {
      if (isCurrent()) { setPendingLeaderTargetId(null); setJourneyBusy(false); }
    }
  }, [groupId, state, navigationDestinations, mapRef, onOptimisticGathering,
    setSelectedIndex, createRequestId, _refresh, refreshNavigationSession, t]);

  const enqueueTeamCommand = useCallback((action: 'start' | 'end', dest: Destination, index: number) => {
    if (!isLeader) {
      if (action === 'start') startLocalRoutePlan(dest, index);
      else setLocalTargetId(null);
      return;
    }
    const intent: TeamCommandIntent = {
      sequence: ++teamCommandSequenceRef.current,
      action,
      destination: dest,
      index,
    };
    // Capture the originating group's callback; a later render/group switch
    // must not execute a new tap using an older drain closure's group/state.
    desiredTeamIntentRef.current.push(() => action === 'start' ? runTeamStart(intent) : runTeamEnd(intent));
    // Every tap is persisted in order; visible state changes after local save.
    const drain = () => {
      if (teamCommandRunnerRef.current) return;
      const run = (async () => {
      while (desiredTeamIntentRef.current.length) {
        const execute = desiredTeamIntentRef.current.shift()!;
        await execute();
      }
    })().finally(() => {
      teamCommandRunnerRef.current = null;
      // A tap can land between the final loop check and finally. Restart
      // without removing/re-appending its head (which would reorder taps).
      if (desiredTeamIntentRef.current.length) drain();
    });
    teamCommandRunnerRef.current = run;
    };
    drain();
  }, [isLeader, startLocalRoutePlan, runTeamStart, runTeamEnd]);

  const startNavigation = useCallback(
    async (dest: Destination, index: number) => {
      enqueueTeamCommand('start', dest, index);
    },
    [enqueueTeamCommand],
  );

  const requestTeamEnd = useCallback(
    async (dest: Destination, index: number) => {
      enqueueTeamCommand('end', dest, index);
    },
    [enqueueTeamCommand],
  );

  const stopNavigation = useCallback(async () => {
    if (isLeader) {
      const dest = navTarget ?? selectedDestination;
      if (dest) await requestTeamEnd(dest, destinations.findIndex((item) => item.id === dest.id));
      return;
    }
    setLocalTargetId(null);
  }, [isLeader, navTarget, selectedDestination, destinations, requestTeamEnd]);

  // Reorder is asynchronous. Project the selected page only after the latest
  // visible carousel order exactly matches the ID-based promote result; a
  // stale array still contains the target but must not clear the pending ID.
  useEffect(() => {
    const targetId = pendingCarouselTargetIdRef.current;
    if (!targetId) return;
    const index = followCarouselIndexAfterPromote({
      destinations: navigationDestinations,
      sharedTargetId: targetId,
    });
    if (index == null) return;
    pendingCarouselTargetIdRef.current = null;
    setSelectedIndex(index);
  }, [navigationDestinations, setSelectedIndex]);

  useEffect(() => {
    if (!sharedTargetId) {
      lastFollowerCenterKeyRef.current = null;
      return;
    }
    const index = followCarouselIndexAfterPromote({
      destinations,
      sharedTargetId,
    });
    if (index == null) return;
    const destination = destinations[index];
    if (!destination) return;
    const orderKey = destinations.map((d) => d.id).join(',');
    const centerKey = `${navigationSession?.id ?? 'legacy'}:${sharedTargetId}:${orderKey}`;
    if (lastFollowerCenterKeyRef.current === centerKey) return;
    lastFollowerCenterKeyRef.current = centerKey;
    setSelectedIndex(index);
    // Target changes from Start/follow are direct selections; only a manual
    // carousel swipe should animate the camera between points.
    mapRef.current?.centerOn(destination.coordinates, { animated: false });
  }, [destinations, mapRef, navigationSession?.id, setSelectedIndex, sharedTargetId]);

  return {
    journeyStatus,
    journeyGoing,
    journeyActive,
    navTarget,
    navTargetId,
    sharedTargetId: sharedTargetId ?? null,
    localTargetId,
    pendingLeaderTargetId,
    activePoint,
    numericDistance,
    journeyBusy,
    openExternalNavigation,
    openInAppleMaps,
    startNavigation,
    requestTeamEnd,
    stopNavigation,
    startLocalRoutePlan,
  };
}
