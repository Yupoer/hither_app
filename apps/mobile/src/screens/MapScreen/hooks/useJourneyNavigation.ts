import { useState, useMemo, useEffect, useRef, useCallback, RefObject } from 'react';
import { Alert, Linking } from 'react-native';
import { notifications } from '../../../native';
import {
  setJourneyStatus,
  reorderDestinations,
  recordVisitedWaypoint,
  deleteDestination,
} from '../../../api/client';
import { distanceMeters } from '../../../utils/geo';
import type { Coordinates, Destination, GroupState } from '../../../types';
import type { ScrollView } from 'react-native';
import type { GroupMapHandle } from '../../../components/GroupMap';

const AUTO_ADVANCE_RADIUS_M = 30;

interface UseJourneyNavigationParams {
  state: GroupState | null;
  groupId: string | null | undefined;
  isLeader: boolean;
  destinations: Destination[];
  selectedDestination: Destination | undefined;
  fromCoords: Coordinates | undefined;
  refresh: () => void;
  t: (key: string, params?: Record<string, any>) => string;
  mapRef: RefObject<GroupMapHandle | null>;
  carouselRef: RefObject<ScrollView | null>;
  setSelectedIndex: (index: number) => void;
}

export function useJourneyNavigation({
  state,
  groupId,
  isLeader,
  destinations,
  selectedDestination,
  fromCoords,
  refresh,
  t,
  mapRef,
  carouselRef,
  setSelectedIndex,
}: UseJourneyNavigationParams) {
  const journeyStatus = state?.group.journeyStatus ?? 'paused';
  const journeyGoing = journeyStatus === 'going';
  const [navTargetId, setNavTargetId] = useState<string | null>(null);
  
  const navTarget = useMemo<Destination | undefined>(
    () => destinations.find((d) => d.id === navTargetId),
    [destinations, navTargetId],
  );

  useEffect(() => {
    if (journeyGoing && !navTargetId && selectedDestination) {
      setNavTargetId(selectedDestination.id);
    } else if (!journeyGoing && navTargetId) {
      setNavTargetId(null);
    }
  }, [journeyGoing, navTargetId, selectedDestination]);

  const journeyActive = journeyGoing && !!navTarget;
  const activePoint = useMemo(() => navTarget ?? selectedDestination, [navTarget, selectedDestination]);

  const numericDistance =
    fromCoords && navTarget ? distanceMeters(fromCoords, navTarget.coordinates) : undefined;

  const openInAppleMaps = useCallback((dest: Destination) => {
    const { latitude, longitude } = dest.coordinates;
    const label = encodeURIComponent(dest.title);
    const scheme = `maps://?daddr=${label}@${latitude},${longitude}&dirflg=w`;
    const universal = `https://maps.apple.com/?daddr=${latitude},${longitude}&dirflg=w`;
    Linking.openURL(scheme).catch(() => void Linking.openURL(universal));
  }, []);

  const [journeyBusy, setJourneyBusy] = useState(false);
  const startNavigation = useCallback(
    async (dest: Destination, index: number) => {
      if (!groupId || journeyBusy) return;
      setJourneyBusy(true);
      setNavTargetId(dest.id);
      mapRef.current?.centerOn(dest.coordinates);
      try {
        if (index > 0) {
          const ids = destinations.map((d) => d.id);
          const [moved] = ids.splice(index, 1);
          ids.unshift(moved);
          const updates = ids.map((id, i) => {
            const dest = destinations.find((d) => d.id === id);
            return { id, position: i, day: dest?.day ?? 1 };
          });
          await reorderDestinations(groupId, updates);
        }
        setSelectedIndex(0);
        carouselRef.current?.scrollTo({ x: 0, animated: true });
        await setJourneyStatus(groupId, 'going');
        refresh();
      } catch {
        setNavTargetId(null);
        Alert.alert(t('map.setFailedTitle'), t('map.journeyFailed'));
      } finally {
        setJourneyBusy(false);
      }
    },
    [groupId, journeyBusy, destinations, refresh, t, mapRef, carouselRef, setSelectedIndex],
  );

  const stopNavigation = useCallback(async () => {
    if (!groupId) return;
    setNavTargetId(null);
    try {
      await setJourneyStatus(groupId, 'paused');
      refresh();
    } catch {
      Alert.alert(t('map.setFailedTitle'), t('map.journeyFailed'));
    }
  }, [groupId, refresh, t]);

  const arrivalFiredRef = useRef(false);
  useEffect(() => {
    if (!journeyActive) {
      arrivalFiredRef.current = false;
      return;
    }
    if (
      isLeader &&
      !arrivalFiredRef.current &&
      numericDistance != null &&
      numericDistance <= AUTO_ADVANCE_RADIUS_M &&
      navTarget &&
      groupId
    ) {
      arrivalFiredRef.current = true;
      const arrivedId = navTarget.id;
      const arrivedTitle = navTarget.title;
      const nextDest = destinations.find((d) => d.id !== arrivedId);
      void recordVisitedWaypoint(groupId, arrivedTitle, navTarget.coordinates);
      void notifications.scheduleLocalNotification({
        title: t('map.arriveTitle'),
        body: nextDest
          ? t('map.autoAdvanceBody', { title: arrivedTitle, next: nextDest.title })
          : t('map.journeyCompleteBody', { title: arrivedTitle }),
        data: { kind: 'arrival', destinationId: arrivedId },
      });
      void deleteDestination(groupId, arrivedId)
        .then(() => (nextDest ? startNavigation(nextDest, 0) : stopNavigation()))
        .catch(() => Alert.alert(t('map.setFailedTitle'), t('map.journeyFailed')));
    }
  }, [
    journeyActive,
    isLeader,
    numericDistance,
    navTarget,
    destinations,
    groupId,
    startNavigation,
    stopNavigation,
    t,
  ]);

  return {
    journeyStatus,
    journeyGoing,
    journeyActive,
    navTarget,
    navTargetId,
    setNavTargetId,
    activePoint,
    numericDistance,
    journeyBusy,
    openInAppleMaps,
    startNavigation,
    stopNavigation,
  };
}
