import { useState, useCallback, useEffect, useRef, RefObject } from 'react';
import type { NativeSyntheticEvent, NativeScrollEvent, ScrollView } from 'react-native';
import type { Destination } from '../../../types';
import type { TravelMode } from '../../../utils/geo';
import { logEvent } from '../../../utils/activityLog';
import type { GroupMapHandle } from '../../../components/GroupMap';

interface UseCarouselSelectionParams {
  destinations: Destination[];
  windowWidth: number;
  carouselRef: RefObject<ScrollView | null>;
  mapRef: RefObject<GroupMapHandle | null>;
  /** Whether card selection should frame its destination with a 30° pitch. */
  obliqueLocate?: boolean;
}

export function useCarouselSelection({
  destinations,
  windowWidth,
  carouselRef,
  mapRef,
  obliqueLocate = true,
}: UseCarouselSelectionParams) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [travelMode, setTravelMode] = useState<TravelMode>('walk');
  // Ignore momentum completions from an older animated scroll after a newer
  // destination ID has become the selected target.
  const programmaticTargetRef = useRef<number | null>(null);
  const userDraggingRef = useRef(false);

  const scrollToIndex = useCallback((index: number, animated: boolean) => {
    programmaticTargetRef.current = index;
    carouselRef.current?.scrollTo({
      x: index * windowWidth,
      animated,
    });
  }, [carouselRef, windowWidth]);

  useEffect(() => {
    const clamped =
      destinations.length === 0 ? 0 : Math.min(selectedIndex, destinations.length - 1);
    if (clamped !== selectedIndex) setSelectedIndex(clamped);
    scrollToIndex(clamped, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinations.length, windowWidth, scrollToIndex]);

  // Programmatic selection (leader journey broadcast → follower force-follow,
  // startNavigation reorder) must move the carousel; user swipes already land
  // on the same offset so re-scrolling is a no-op.
  useEffect(() => {
    if (destinations.length === 0) return;
    scrollToIndex(selectedIndex, true);
  }, [selectedIndex, destinations.length, scrollToIndex]);

  const selectedDestination: Destination | undefined = destinations[selectedIndex];

  const handleScrollBeginDrag = useCallback(() => {
    userDraggingRef.current = true;
    programmaticTargetRef.current = null;
  }, []);

  const handleMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (destinations.length === 0) return;
      const index = Math.round(e.nativeEvent.contentOffset.x / windowWidth);
      const clamped = Math.max(0, Math.min(index, destinations.length - 1));
      const programmaticTarget = programmaticTargetRef.current;
      if (!userDraggingRef.current) {
        // Native scroll events can arrive after a newer programmatic target
        // has settled. They are never user intent, so they must not move the
        // selected card back to an obsolete index.
        if (programmaticTarget != null && clamped === programmaticTarget) {
          programmaticTargetRef.current = null;
        }
        return;
      }
      userDraggingRef.current = false;
      programmaticTargetRef.current = null;
      if (clamped !== selectedIndex) {
        setSelectedIndex(clamped);
        logEvent('carousel_swipe', { index: clamped });
        if (obliqueLocate && mapRef.current?.focusOblique) {
          mapRef.current?.focusOblique(destinations[clamped].coordinates);
        } else {
          mapRef.current?.centerOn(destinations[clamped].coordinates);
        }
      }
    },
    [destinations, windowWidth, selectedIndex, mapRef, obliqueLocate],
  );

  return {
    selectedIndex,
    setSelectedIndex,
    travelMode,
    setTravelMode,
    selectedDestination,
    handleScrollBeginDrag,
    handleMomentumEnd,
  };
}
