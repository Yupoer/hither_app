import * as Crypto from 'expo-crypto';
import { useState, useMemo, useEffect, useCallback, useRef, RefObject } from 'react';
import { Alert } from 'react-native';
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
import {
  abortLeaderGatheringStart,
  enqueueLeaderGatheringStart,
  flushCoreOperationOutbox,
} from '../../../state/coreDataSync';
import { logEvent } from '../../../utils/activityLog';

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
  startSession?: (destinationId: string, requestId: string) => Promise<NavigationSession>;
  cancelSession?: () => Promise<NavigationSession | null>;
  createRequestId?: () => string;
  /** Persist itinerary reorder before starting a shared navigation session. */
  reorderForNavigation?: (
    updates: { id: string; position: number; day: number }[],
  ) => Promise<boolean>;
  /** Travel mode for external maps deep-links (defaults to walk). */
  travelMode?: TravelMode;
  /** Project local-first gathering into React state after outbox enqueue. */
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
  t,
  mapRef,
  carouselRef,
  setSelectedIndex,
  navigationSession,
  startSession,
  cancelSession,
  createRequestId = Crypto.randomUUID,
  reorderForNavigation,
  travelMode = 'walk',
  onOptimisticGathering,
}: UseJourneyNavigationParams) {
  const legacyMode = navigationSession === undefined;
  const legacySharedTargetId = legacyMode && state?.group.journeyStatus === 'going'
    ? state.group.activeDestinationId ?? null
    : null;
  const sharedTargetId = navigationSession?.status === 'active'
    ? navigationSession.destinationId
    : legacySharedTargetId;
  const [localTargetId, setLocalTargetId] = useState<string | null>(null);
  const [pendingLeaderTargetId, setPendingLeaderTargetId] = useState<string | null>(null);
  const [pendingLeaderStop, setPendingLeaderStop] = useState(false);
  const lastFollowerCenterKeyRef = useRef<string | null>(null);
  const requestRef = useRef<{ destinationId: string; requestId: string } | null>(null);

  useEffect(() => {
    if (sharedTargetId && pendingLeaderTargetId === sharedTargetId) {
      setPendingLeaderTargetId(null);
    }
    if (sharedTargetId) setPendingLeaderStop(false);
  }, [pendingLeaderTargetId, sharedTargetId]);

  // Shared flock session always owns the target (leader + members). Members do
  // not need to tap「路徑」— reopening the app after a leader start still joins.
  const navTargetId = sharedTargetId ??
    (isLeader ? pendingLeaderTargetId : localTargetId);
  const navTarget = useMemo<Destination | undefined>(() => {
    if (!navTargetId) return undefined;
    const fromList = navigationDestinations.find(
      (destination) => destination.id === navTargetId,
    );
    if (fromList) return fromList;
    // Session may target a stop not in the day-filtered carousel; synthesize
    // so journeyActive / routes / arrival still engage.
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
  const [journeyBusy, setJourneyBusy] = useState(false);
  const stopInFlightRef = useRef<Promise<void> | null>(null);

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

  const startNavigation = useCallback(
    async (dest: Destination, index: number) => {
      if (!isLeader) {
        startLocalRoutePlan(dest, index);
        return;
      }
      if (!groupId || journeyBusy || !startSession) {
        logEvent('nav_start_blocked', {
          reason: !groupId ? 'no_group' : journeyBusy ? 'busy' : 'no_start_session',
          destId: dest.id,
        });
        if (journeyBusy) {
          Alert.alert(t('map.setFailedTitle'), t('map.startBusy'));
        } else if (!startSession) {
          Alert.alert(t('map.setFailedTitle'), t('map.journeyFailed'));
        }
        return;
      }
      // OTA-01: never Start while a shared session is already active.
      if (sharedTargetId) {
        logEvent('nav_start_blocked', { reason: 'session_active', destId: dest.id });
        Alert.alert(t('map.setFailedTitle'), t('map.startBlocked'));
        return;
      }
      // Next open stop only (order asc); UI also gates, this covers all call sites.
      const nextOpen = destinations
        .filter((d) => !d.closedAt)
        .slice()
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))[0];
      if (nextOpen && nextOpen.id !== dest.id) {
        logEvent('nav_start_blocked', {
          reason: 'not_next_open',
          destId: dest.id,
          nextOpenId: nextOpen.id,
        });
        Alert.alert(t('map.setFailedTitle'), t('map.startBlocked'));
        return;
      }

      logEvent('nav_start_requested', { destId: dest.id });
      setJourneyBusy(true);
      setPendingLeaderStop(false);
      setPendingLeaderTargetId(dest.id);
      mapRef.current?.centerOn(dest.coordinates);
      let enqueued: {
        local: ActiveGatheringState;
        base: ActiveGatheringState;
        operationId: string;
      } | null = null;
      try {
        // OTA-04: local-first write without immediate flush so a business
        // rejection from legacy startSession cannot leave a doomed outbox.
        enqueued = await enqueueLeaderGatheringStart(groupId, {
          groupState: state,
          activeDestinationId: dest.id,
          flushImmediately: false,
        });
        onOptimisticGathering?.(enqueued.local);

        // Promote chosen stop to first open slot of its day before session start.
        if (reorderForNavigation) {
          const updates = promoteDestinationWithinDay(destinations, dest.id);
          const nextIndex = updates.findIndex((item) => item.id === dest.id);
          if (!(await reorderForNavigation(updates))) {
            throw new Error('destination_reorder_failed');
          }
          setSelectedIndex(Math.max(0, nextIndex));
        } else {
          setSelectedIndex(index);
        }
        if (!requestRef.current || requestRef.current.destinationId !== dest.id) {
          requestRef.current = { destinationId: dest.id, requestId: createRequestId() };
        }
        try {
          await startSession(dest.id, requestRef.current.requestId);
          requestRef.current = null;
          // Session exists — safe to push gathering Start (classifier: flush).
          void flushCoreOperationOutbox().catch(() => undefined);
        } catch (sessionError) {
          const outboxAction = resolveGatheringOutboxAfterSessionStart({
            ok: false,
            isNetworkError: isNetworkRequestError(sessionError),
          });
          if (outboxAction === 'abort') {
            // Business rejection / non-retryable: revoke optimistic gathering.
            requestRef.current = null;
            await abortLeaderGatheringStart({
              operationId: enqueued.operationId,
              restore: enqueued.base,
              message:
                sessionError instanceof Error
                  ? sessionError.message
                  : 'legacy navigation session rejected',
            });
            onOptimisticGathering?.(enqueued.base);
            enqueued = null;
            throw sessionError;
          }
          // keep_pending: transient offline — keep outbox + request id.
          // Do NOT flush; navigation_sessions does not exist yet.
        }
      } catch (error) {
        if (enqueued) {
          // Reorder / other failures after enqueue also must not keep Start.
          if (!isNetworkRequestError(error)) {
            await abortLeaderGatheringStart({
              operationId: enqueued.operationId,
              restore: enqueued.base,
              message:
                error instanceof Error ? error.message : 'gathering start aborted',
            }).catch(() => undefined);
            onOptimisticGathering?.(enqueued.base);
          }
        }
        setPendingLeaderTargetId(null);
        Alert.alert(t('map.setFailedTitle'), t('map.journeyFailed'));
      } finally {
        setJourneyBusy(false);
      }
    },
    [
      isLeader,
      startLocalRoutePlan,
      groupId,
      journeyBusy,
      startSession,
      sharedTargetId,
      t,
      mapRef,
      carouselRef,
      setSelectedIndex,
      createRequestId,
      reorderForNavigation,
      destinations,
      state,
      onOptimisticGathering,
    ],
  );

  const stopNavigation = useCallback(async () => {
    if (!isLeader) {
      setLocalTargetId(null);
      return;
    }
    if (!groupId || !cancelSession) return;
    if (stopInFlightRef.current) return stopInFlightRef.current;
    if (journeyBusy) return;
    setJourneyBusy(true);
    setPendingLeaderStop(true);
    const run = (async () => {
      try {
        await cancelSession();
        setPendingLeaderTargetId(null);
      } catch {
        setPendingLeaderStop(false);
        Alert.alert(t('map.setFailedTitle'), t('map.journeyFailed'));
      } finally {
        setJourneyBusy(false);
        stopInFlightRef.current = null;
      }
    })();
    stopInFlightRef.current = run;
    return run;
  }, [cancelSession, groupId, journeyBusy, isLeader, t]);

  // Re-center leader and followers when shared target order changes (post-promote).
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
    /** Shared flock session / legacy journey target (not member local plan). */
    sharedTargetId: sharedTargetId ?? null,
    /** Member local path-plan target. */
    localTargetId,
    /** Leader optimistic target while start is in flight. */
    pendingLeaderTargetId,
    activePoint,
    numericDistance,
    journeyBusy,
    openExternalNavigation,
    openInAppleMaps,
    startNavigation,
    stopNavigation,
    startLocalRoutePlan,
  };
}
