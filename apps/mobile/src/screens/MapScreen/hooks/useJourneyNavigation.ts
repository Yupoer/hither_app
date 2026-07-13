import { useState, useMemo, useEffect, useCallback, RefObject } from 'react';
import { Alert, Linking } from 'react-native';
import {
  setJourneyTarget,
  reorderDestinations,
} from '../../../api/client';
import { distanceMeters } from '../../../utils/geo';
import type { Coordinates, Destination, GroupState, JourneyStatus } from '../../../types';
import type { ScrollView } from 'react-native';
import type { GroupMapHandle } from '../../../components/GroupMap';

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
  const serverJourneyStatus = state?.group.journeyStatus;
  const [pendingJourneyStatus, setPendingJourneyStatus] = useState<JourneyStatus | null>(null);
  const journeyStatus = pendingJourneyStatus ?? serverJourneyStatus ?? 'paused';
  const journeyGoing = journeyStatus === 'going';
  const serverTargetId = state?.group.activeDestinationId ?? null;
  const [pendingTargetId, setPendingTargetId] = useState<string | null | undefined>(
    undefined,
  );
  const navTargetId = pendingTargetId !== undefined ? pendingTargetId : serverTargetId;
  
  const navTarget = useMemo<Destination | undefined>(
    () => destinations.find((d) => d.id === navTargetId),
    [destinations, navTargetId],
  );

  useEffect(() => {
    if (
      pendingJourneyStatus &&
      serverJourneyStatus === pendingJourneyStatus &&
      serverTargetId === pendingTargetId
    ) {
      setPendingJourneyStatus(null);
      setPendingTargetId(undefined);
    }
  }, [pendingJourneyStatus, pendingTargetId, serverJourneyStatus, serverTargetId]);

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
      setPendingJourneyStatus('going');
      setPendingTargetId(dest.id);
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
        await setJourneyTarget(groupId, dest.id);
        await refresh();
      } catch {
        setPendingJourneyStatus(null);
        setPendingTargetId(undefined);
        Alert.alert(t('map.setFailedTitle'), t('map.journeyFailed'));
      } finally {
        setJourneyBusy(false);
      }
    },
    [groupId, journeyBusy, destinations, refresh, t, mapRef, carouselRef, setSelectedIndex],
  );

  const stopNavigation = useCallback(async () => {
    if (!groupId || journeyBusy) return;
    setJourneyBusy(true);
    setPendingJourneyStatus('paused');
    setPendingTargetId(null);
    try {
      await setJourneyTarget(groupId, null);
      await refresh();
    } catch {
      setPendingJourneyStatus(null);
      setPendingTargetId(undefined);
      Alert.alert(t('map.setFailedTitle'), t('map.journeyFailed'));
    } finally {
      setJourneyBusy(false);
    }
  }, [groupId, journeyBusy, refresh, t]);

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
  };
}
