import * as Crypto from 'expo-crypto';
import { useState, useMemo, useEffect, useCallback, useRef, RefObject } from 'react';
import { Alert } from 'react-native';
import { distanceMeters } from '../../../utils/geo';
import { promoteDestinationWithinDay } from '../../../utils/tripDay';
import type { Coordinates, Destination, GroupState, JourneyStatus } from '../../../types';
import type { NavigationSession } from '../../../types/navigation';
import type { ScrollView } from 'react-native';
import type { GroupMapHandle } from '../../../components/GroupMap';
import { openExternalNavigation as openExternalNav } from '../../../native/externalNavigation';
import type { TravelMode } from '../../../native/maps';

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

  const navTargetId = sharedTargetId ??
    (isLeader ? pendingLeaderTargetId : localTargetId);
  const navTarget = useMemo<Destination | undefined>(
    () => navigationDestinations.find((destination) => destination.id === navTargetId),
    [navigationDestinations, navTargetId],
  );
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
      if (!groupId || journeyBusy || !startSession) return;
      setJourneyBusy(true);
      setPendingLeaderStop(false);
      setPendingLeaderTargetId(dest.id);
      mapRef.current?.centerOn(dest.coordinates);
      try {
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
        await startSession(dest.id, requestRef.current.requestId);
        requestRef.current = null;
      } catch {
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
      t,
      mapRef,
      carouselRef,
      setSelectedIndex,
      createRequestId,
      reorderForNavigation,
      destinations,
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
