import * as Crypto from 'expo-crypto';
import { useState, useMemo, useEffect, useCallback, useRef, RefObject } from 'react';
import { Alert, Linking } from 'react-native';
import { reorderDestinations } from '../../../api/client';
import { distanceMeters } from '../../../utils/geo';
import type { Coordinates, Destination, GroupState, JourneyStatus } from '../../../types';
import type { NavigationSession } from '../../../types/navigation';
import type { ScrollView } from 'react-native';
import type { GroupMapHandle } from '../../../components/GroupMap';

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

  const openInAppleMaps = useCallback((dest: Destination) => {
    const { latitude, longitude } = dest.coordinates;
    const label = encodeURIComponent(dest.title);
    const scheme = `maps://?daddr=${label}@${latitude},${longitude}&dirflg=w`;
    const universal = `https://maps.apple.com/?daddr=${latitude},${longitude}&dirflg=w`;
    Linking.openURL(scheme).catch(() => void Linking.openURL(universal));
  }, []);

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
        const navigationIndex = navigationDestinations.findIndex(
          (item) => item.id === dest.id,
        );
        if (navigationIndex > 0) {
          const ids = navigationDestinations.map((item) => item.id);
          const [moved] = ids.splice(navigationIndex, 1);
          ids.unshift(moved);
          await reorderDestinations(
            groupId,
            ids.map((id, position) => ({
              id,
              position,
              day: navigationDestinations.find((item) => item.id === id)?.day ?? 1,
            })),
          );
        }
        setSelectedIndex(0);
        carouselRef.current?.scrollTo({ x: 0, animated: true });
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
      navigationDestinations,
      t,
      mapRef,
      carouselRef,
      setSelectedIndex,
      createRequestId,
    ],
  );

  const stopNavigation = useCallback(async () => {
    if (!isLeader) {
      setLocalTargetId(null);
      return;
    }
    if (!groupId || journeyBusy || !cancelSession) return;
    setJourneyBusy(true);
    setPendingLeaderStop(true);
    try {
      await cancelSession();
      setPendingLeaderTargetId(null);
    } catch {
      setPendingLeaderStop(false);
      Alert.alert(t('map.setFailedTitle'), t('map.journeyFailed'));
    } finally {
      setJourneyBusy(false);
    }
  }, [cancelSession, groupId, journeyBusy, isLeader, t]);

  useEffect(() => {
    if (isLeader || !sharedTargetId) {
      lastFollowerCenterKeyRef.current = null;
      return;
    }
    const index = destinations.findIndex((destination) => destination.id === sharedTargetId);
    const destination = destinations[index];
    if (!destination) return;
    const centerKey = `${navigationSession?.id ?? 'legacy'}:${sharedTargetId}`;
    if (lastFollowerCenterKeyRef.current === centerKey) return;
    lastFollowerCenterKeyRef.current = centerKey;
    setSelectedIndex(index);
    mapRef.current?.centerOn(destination.coordinates);
  }, [destinations, isLeader, mapRef, navigationSession?.id, setSelectedIndex, sharedTargetId]);

  return {
    journeyStatus,
    journeyGoing,
    journeyActive,
    navTarget,
    navTargetId,
    activePoint,
    numericDistance,
    journeyBusy,
    openInAppleMaps,
    startNavigation,
    stopNavigation,
    startLocalRoutePlan,
  };
}
