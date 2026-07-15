import { useState, useCallback, useEffect, RefObject } from 'react';
import type { NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import type { Destination } from '../../../types';
import type { TravelMode } from '../../../utils/geo';
import { logEvent } from '../../../utils/activityLog';
import type { ScrollView } from 'react-native';
import type { GroupMapHandle } from '../../../components/GroupMap';

interface UseCarouselSelectionParams {
  destinations: Destination[];
  windowWidth: number;
  carouselRef: RefObject<ScrollView | null>;
  mapRef: RefObject<GroupMapHandle | null>;
}

export function useCarouselSelection({
  destinations,
  windowWidth,
  carouselRef,
  mapRef,
}: UseCarouselSelectionParams) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [travelMode, setTravelMode] = useState<TravelMode>('walk');

  useEffect(() => {
    const clamped =
      destinations.length === 0 ? 0 : Math.min(selectedIndex, destinations.length - 1);
    if (clamped !== selectedIndex) setSelectedIndex(clamped);
    carouselRef.current?.scrollTo({ x: clamped * windowWidth, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinations.length, windowWidth]);

  // Programmatic selection (leader journey broadcast → follower force-follow,
  // startNavigation reorder) must move the carousel; user swipes already land
  // on the same offset so re-scrolling is a no-op.
  useEffect(() => {
    if (destinations.length === 0) return;
    carouselRef.current?.scrollTo({
      x: selectedIndex * windowWidth,
      animated: true,
    });
  }, [selectedIndex, windowWidth, destinations.length, carouselRef]);

  const selectedDestination: Destination | undefined = destinations[selectedIndex];

  const handleMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (destinations.length === 0) return;
      const index = Math.round(e.nativeEvent.contentOffset.x / windowWidth);
      const clamped = Math.max(0, Math.min(index, destinations.length - 1));
      if (clamped !== selectedIndex) {
        setSelectedIndex(clamped);
        logEvent('carousel_swipe', { index: clamped });
        mapRef.current?.centerOn(destinations[clamped].coordinates);
      }
    },
    [destinations, windowWidth, selectedIndex, mapRef],
  );

  return {
    selectedIndex,
    setSelectedIndex,
    travelMode,
    setTravelMode,
    selectedDestination,
    handleMomentumEnd,
  };
}
