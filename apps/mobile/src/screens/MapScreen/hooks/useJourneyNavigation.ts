import * as Crypto from 'expo-crypto';
import { useState, useMemo, useEffect, useCallback, useRef, RefObject } from 'react';
import { isNetworkRequestError } from '../../../api/services/_helpers';
import { distanceMeters } from '../../../utils/geo';
import { resolveGatheringOutboxAfterSessionStart } from '../../../utils/gatheringSessionOutbox';
import { promoteDestinationWithinDay } from '../../../utils/tripDay';
import type { Coordinates, Destination, GroupState, JourneyStatus } from '../../../types';
import type { NavigationSession } from '../../../types/navigation';
import type { ScrollView } from 'react-native';
import type { GroupMapHandle } from '../../../components/GroupMap';
import { openExternalNavigation as openExternalNav } from '../../../native/externalNavigation';
import type { TravelMode } from '../../../native/maps';
import type { ActiveGatheringState } from '../../../types/coreData';
import { deriveActiveGatheringFromGroupState } from '../../../utils/activeGatheringState';
import {
  abortLeaderGatheringStart,
  enqueueLeaderGatheringEnd,
  enqueueLeaderGatheringStart,
  enqueueLeaderGatheringSwitch,
  flushCoreOperationOutbox,
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
    updates: { id: string; position: number; day: number }[],
  ) => Promise<boolean>;
  travelMode?: TravelMode;
  onOptimisticGathering?: (gathering: ActiveGatheringState) => void;
}

export function useJourneyNavigation({
  state,
  groupId,
  isLeader,
  destinations,
  navigationDestinations = destinations,
  selectedDestination,
  fromCoords,
  refresh: _refresh,
  t: _t,
  mapRef,
  carouselRef: _carouselRef,
  setSelectedIndex,
  navigationSession,
  startSession,
  cancelSession,
  refreshNavigationSession,
  createRequestId = Crypto.randomUUID,
  reorderForNavigation,
  travelMode = 'walk',
  onOptimisticGathering,
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
  const desiredTeamIntentRef = useRef<TeamCommandIntent | null>(null);
  const teamCommandRunnerRef = useRef<Promise<void> | null>(null);
  const teamCommandSequenceRef = useRef(0);
  const gatheringStateRef = useRef<ActiveGatheringState | null>(null);
  const serverOrStartedSessionRef = useRef(Boolean(authoritativeSharedTargetId));
  const startPromiseRef = useRef<Promise<void> | null>(null);
  const pendingStartRef = useRef<{
    operationId: string;
    base: ActiveGatheringState;
  } | null>(null);

  const restorePendingStart = useCallback(async () => {
    const pending = pendingStartRef.current;
    if (!pending) return false;
    await abortLeaderGatheringStart({
      operationId: pending.operationId,
      restore: pending.base,
      message: 'navigation start superseded by End',
    }).catch(() => undefined);
    pendingStartRef.current = null;
    gatheringStateRef.current = pending.base;
    onOptimisticGathering?.(pending.base);
    serverOrStartedSessionRef.current = false;
    setOptimisticTeamTargetId(null);
    return true;
  }, [onOptimisticGathering]);

  const sharedTargetId = optimisticTeamTargetId !== undefined
    ? optimisticTeamTargetId
    : authoritativeSharedTargetId;

  useEffect(() => {
    if (!gatheringStateRef.current && state) {
      gatheringStateRef.current = deriveActiveGatheringFromGroupState(state, 0);
    }
  }, [state]);

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

  const openExternalNavigation = useCallback(
    (dest: Destination) => {
      void openExternalNav(dest, travelMode);
    },
    [travelMode],
  );

  /** @deprecated Use openExternalNavigation — kept as alias for gradual call-site migration. */
  const openInAppleMaps = openExternalNavigation;

  const startLocalRoutePlan = useCallback(
    (dest: Destination, index: number) => {
      setLocalTargetId(dest.id);
      setSelectedIndex(index);
      mapRef.current?.centerOn(dest.coordinates);
    },
    [mapRef, setSelectedIndex],
  );

  const runTeamEnd = useCallback(async (intent: TeamCommandIntent): Promise<void> => {
    if (!groupId) return;
    const dest = intent.destination;
    if (pendingStartRef.current && !serverOrStartedSessionRef.current) {
      if (startPromiseRef.current) await startPromiseRef.current;
      if (!serverOrStartedSessionRef.current) {
        await restorePendingStart();
        return;
      }
    }
    // If Start failed before creating a server session and the newest intent is
    // End, there is nothing to pause. Keep the UI at staying and drop the
    // superseded local Start instead of invoking a terminal RPC that must fail.
    const baseState = gatheringStateRef.current
      ?? (state ? deriveActiveGatheringFromGroupState(state, 0) : null);
    const hasLocalActive = baseState?.journeyPhase === 'en_route';
    if (!serverOrStartedSessionRef.current && !hasLocalActive) {
      if (startPromiseRef.current) {
        await startPromiseRef.current;
      }
      const refreshedState = gatheringStateRef.current;
      if (!serverOrStartedSessionRef.current && refreshedState?.journeyPhase !== 'en_route') return;
    }

    setJourneyBusy(true);
    setPendingLeaderStop(true);
    setOptimisticTeamTargetId(null);
    try {
      // End navigation = pause only. Point stays open (pending); no closed_at.
      // Completing a stop is a separate action (completeGatheringStop).
      const result = await enqueueLeaderGatheringEnd(groupId, {
        baseState: baseState ?? undefined,
        groupState: state,
      });
      gatheringStateRef.current = result.local;
      onOptimisticGathering?.(result.local);
      // Cancel flock nav session (mirrors groups.journey → paused; never closes itinerary).
      await cancelSession?.().catch(() => undefined);
      _refresh();
      serverOrStartedSessionRef.current = false;
    } catch {
      logEvent('nav_end_pending', { destId: dest.id, sequence: intent.sequence });
    } finally {
      setPendingLeaderStop(false);
      setPendingLeaderTargetId(null);
      setJourneyBusy(false);
    }
  }, [groupId, state, onOptimisticGathering, _refresh, cancelSession]);

  const runTeamStart = useCallback(async (intent: TeamCommandIntent): Promise<void> => {
    if (!groupId || !startSession) return;
    const { destination: dest, index } = intent;

    // A Start on another open point is a switch, not End. Keep the old point
    // pending (never completed/closed) and replace the active session atomically.
    const switching = Boolean(sharedTargetId && sharedTargetId !== dest.id);

    setJourneyBusy(true);
    setPendingLeaderStop(false);
    setPendingLeaderTargetId(dest.id);
    setOptimisticTeamTargetId(dest.id);
    serverOrStartedSessionRef.current = false;
    mapRef.current?.centerOn(dest.coordinates);

    let enqueued: {
      local: ActiveGatheringState;
      base: ActiveGatheringState;
      operationId: string;
    } | null = null;
    try {
      const baseState = gatheringStateRef.current
        ?? (state ? deriveActiveGatheringFromGroupState(state, 0) : undefined);
      enqueued = switching
        ? await enqueueLeaderGatheringSwitch(groupId, {
            baseState,
            groupState: state,
            activeDestinationId: dest.id,
            flushImmediately: false,
          })
        : await enqueueLeaderGatheringStart(groupId, {
            baseState,
            groupState: state,
            activeDestinationId: dest.id,
            flushImmediately: false,
          });
      // Switch and Start share the same local-first optimistic contract; the
      // session RPC below is the server-side handoff and must succeed first.
      if (switching) {
        logEvent('nav_switch_requested', {
          fromDestId: sharedTargetId,
          destId: dest.id,
          sequence: intent.sequence,
        });
      }
      gatheringStateRef.current = enqueued.local;
      pendingStartRef.current = { operationId: enqueued.operationId, base: enqueued.base };
      onOptimisticGathering?.(enqueued.local);

      if (reorderForNavigation) {
        const updates = promoteDestinationWithinDay(destinations, dest.id);
        const nextIndex = updates.findIndex((item) => item.id === dest.id);
        if (!(await reorderForNavigation(updates))) throw new Error('destination_reorder_failed');
        setSelectedIndex(Math.max(0, nextIndex));
      } else {
        setSelectedIndex(index);
      }

      if (!requestRef.current || requestRef.current.destinationId !== dest.id) {
        requestRef.current = { destinationId: dest.id, requestId: createRequestId() };
      }
      try {
        if (switching) {
          await startSession(dest.id, requestRef.current.requestId, true);
        } else {
          await startSession(dest.id, requestRef.current.requestId);
        }
        requestRef.current = null;
        serverOrStartedSessionRef.current = true;
        pendingStartRef.current = null;
        void flushCoreOperationOutbox().catch(() => undefined);
      } catch (sessionError) {
        const outboxAction = resolveGatheringOutboxAfterSessionStart({
          ok: false,
          isNetworkError: isNetworkRequestError(sessionError),
        });
        if (outboxAction === 'abort') {
          requestRef.current = null;
          const reconciled = refreshNavigationSession
            ? await refreshNavigationSession().catch(() => null)
            : null;
          if (reconciled?.status === 'active') {
            serverOrStartedSessionRef.current = true;
          } else {
            await abortLeaderGatheringStart({
              operationId: enqueued.operationId,
              restore: enqueued.base,
              message: 'navigation start rejected',
            });
            gatheringStateRef.current = enqueued.base;
            pendingStartRef.current = null;
            onOptimisticGathering?.(enqueued.base);
            serverOrStartedSessionRef.current = false;
            setOptimisticTeamTargetId(null);
          }
        }
        // keep_pending: network errors retain the Start outbox. A newer End
        // still supersedes the UI and is processed by this same runner after
        // the promise settles; do not flush before a session row exists.
        // keep_pending:
      }
    } catch (error) {
      if (enqueued && !isNetworkRequestError(error)) {
        await abortLeaderGatheringStart({
          operationId: enqueued.operationId,
          restore: enqueued.base,
          message: 'gathering start aborted',
        }).catch(() => undefined);
        gatheringStateRef.current = enqueued.base;
        onOptimisticGathering?.(enqueued.base);
        serverOrStartedSessionRef.current = false;
        setOptimisticTeamTargetId(null);
      }
      logEvent('nav_start_failed', { destId: dest.id, sequence: intent.sequence });
    } finally {
      setPendingLeaderTargetId(null);
      setJourneyBusy(false);
    }
  }, [
    groupId,
    startSession,
    state,
    sharedTargetId,
    navigationDestinations,
    mapRef,
    onOptimisticGathering,
    reorderForNavigation,
    destinations,
    setSelectedIndex,
    createRequestId,
    runTeamEnd,
    restorePendingStart,
  ]);

  const enqueueTeamCommand = useCallback((action: 'start' | 'end', dest: Destination, index: number) => {
    if (!isLeader) {
      if (action === 'start') startLocalRoutePlan(dest, index);
      else setLocalTargetId(null);
      return;
    }
    desiredTeamIntentRef.current = {
      sequence: ++teamCommandSequenceRef.current,
      action,
      destination: dest,
      index,
    };
    // Paint the latest intent before any promise is awaited.
    setOptimisticTeamTargetId(action === 'start' ? dest.id : null);
    if (teamCommandRunnerRef.current) return;

    const run = (async () => {
      while (desiredTeamIntentRef.current) {
        const next = desiredTeamIntentRef.current;
        desiredTeamIntentRef.current = null;
        if (next.action === 'start') {
          const startRun = runTeamStart(next);
          startPromiseRef.current = startRun;
          try {
            await startRun;
          } finally {
            if (startPromiseRef.current === startRun) startPromiseRef.current = null;
          }
        } else {
          await runTeamEnd(next);
        }
      }
    })().finally(() => {
      teamCommandRunnerRef.current = null;
      // A tap can land between the final loop check and finally. Start one
      // runner for that latest intent without recursively awaiting itself.
      if (desiredTeamIntentRef.current) {
        enqueueTeamCommand(
          desiredTeamIntentRef.current.action,
          desiredTeamIntentRef.current.destination,
          desiredTeamIntentRef.current.index,
        );
      }
    });
    teamCommandRunnerRef.current = run;
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

  useEffect(() => {
    if (!sharedTargetId) {
      lastFollowerCenterKeyRef.current = null;
      return;
    }
    const index = destinations.findIndex((destination) => destination.id === sharedTargetId);
    const destination = destinations[index];
    if (!destination) return;
    const orderKey = destinations.map((d) => d.id).join(',');
    const centerKey = `${navigationSession?.id ?? 'legacy'}:${sharedTargetId}:${orderKey}`;
    if (lastFollowerCenterKeyRef.current === centerKey) return;
    lastFollowerCenterKeyRef.current = centerKey;
    setSelectedIndex(index);
    mapRef.current?.centerOn(destination.coordinates);
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
