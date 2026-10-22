import { createElement, Fragment, useState, useCallback, useRef, RefObject } from 'react';
import { useMountEffect } from '../../../hooks/useMountEffect';
import type { NativeSyntheticEvent, NativeScrollEvent, ScrollView } from 'react-native';
import type { Destination } from '../../../types';
import { usePreferences } from '../../../state/PreferencesContext';
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
  const { travelMode, setTravelMode } = usePreferences();
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

  const carouselBoundsScrollLifecycle = createElement(CarouselBoundsScroll, { destinations, selectedIndex, setSelectedIndex, scrollToIndex, windowWidth });

  // Programmatic selection (leader journey broadcast → follower force-follow,
  // startNavigation reorder) must move the carousel; user swipes already land
  // on the same offset so re-scrolling is a no-op.
  const carouselSelectionScrollLifecycle = createElement(CarouselSelectionScroll, { destinations, scrollToIndex, selectedIndex });

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
    lifecycle: createElement(Fragment, { key: 'carousel-selection-runtime' }, carouselBoundsScrollLifecycle, carouselSelectionScrollLifecycle),
    selectedIndex,
    setSelectedIndex,
    travelMode,
    setTravelMode,
    selectedDestination,
    handleScrollBeginDrag,
    handleMomentumEnd,
  };
}

function CarouselBoundsScroll({ destinations, selectedIndex, setSelectedIndex, scrollToIndex, windowWidth }: {
  destinations: Destination[];
  selectedIndex: number;
  setSelectedIndex: import("react").Dispatch<import("react").SetStateAction<number>>;
  scrollToIndex: (index: number, animated: boolean) => void;
  windowWidth: number;
}) {
  const [carouselBoundsScrollInputs, setCarouselBoundsScrollInputs] = useState(() => ({ generation: 0, destinations_length: destinations.length, windowWidth, scrollToIndex }));
  if (!(Object.is(carouselBoundsScrollInputs.destinations_length, destinations.length) && Object.is(carouselBoundsScrollInputs.windowWidth, windowWidth) && Object.is(carouselBoundsScrollInputs.scrollToIndex, scrollToIndex))) {
    setCarouselBoundsScrollInputs({ generation: carouselBoundsScrollInputs.generation + 1, destinations_length: destinations.length, windowWidth, scrollToIndex });
  }
  return createElement(CarouselBoundsScrollCommit, { key: carouselBoundsScrollInputs.generation, destinations, selectedIndex, setSelectedIndex, scrollToIndex, windowWidth });
}

function CarouselBoundsScrollCommit({ destinations, selectedIndex, setSelectedIndex, scrollToIndex, windowWidth }: {
  destinations: Destination[];
  selectedIndex: number;
  setSelectedIndex: import("react").Dispatch<import("react").SetStateAction<number>>;
  scrollToIndex: (index: number, animated: boolean) => void;
  windowWidth: number;
}) {
  useMountEffect(() => {
    const clamped =
      destinations.length === 0 ? 0 : Math.min(selectedIndex, destinations.length - 1);
    if (clamped !== selectedIndex) setSelectedIndex(clamped);
    scrollToIndex(clamped, false);
  });
  return null;
}

function CarouselSelectionScroll({ destinations, scrollToIndex, selectedIndex }: {
  destinations: Destination[];
  scrollToIndex: (index: number, animated: boolean) => void;
  selectedIndex: number;
}) {
  const [carouselSelectionScrollInputs, setCarouselSelectionScrollInputs] = useState(() => ({ generation: 0, selectedIndex, destinations_length: destinations.length, scrollToIndex }));
  if (!(Object.is(carouselSelectionScrollInputs.selectedIndex, selectedIndex) && Object.is(carouselSelectionScrollInputs.destinations_length, destinations.length) && Object.is(carouselSelectionScrollInputs.scrollToIndex, scrollToIndex))) {
    setCarouselSelectionScrollInputs({ generation: carouselSelectionScrollInputs.generation + 1, selectedIndex, destinations_length: destinations.length, scrollToIndex });
  }
  return createElement(CarouselSelectionScrollCommit, { key: carouselSelectionScrollInputs.generation, destinations, scrollToIndex, selectedIndex });
}

function CarouselSelectionScrollCommit({ destinations, scrollToIndex, selectedIndex }: {
  destinations: Destination[];
  scrollToIndex: (index: number, animated: boolean) => void;
  selectedIndex: number;
}) {
  useMountEffect(() => {
    if (destinations.length === 0) return;
    scrollToIndex(selectedIndex, true);
  });
  return null;
}
