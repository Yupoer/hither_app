import React from 'react';
import { act, create } from 'react-test-renderer';
import { useCarouselSelection } from '../screens/MapScreen/hooks/useCarouselSelection';
import type { Destination } from '../types';

jest.mock('../utils/activityLog', () => ({ logEvent: jest.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const destinations = ['a', 'b', 'c'].map((id, index) => ({
  id,
  title: id,
  order: index,
  day: 1,
  coordinates: { latitude: 25 + index, longitude: 121 },
})) as Destination[];

describe('useCarouselSelection', () => {
  it('ignores stale programmatic momentum after an ID reorder target changes', () => {
    const scrollTo = jest.fn();
    const centerOn = jest.fn();
    let selection: ReturnType<typeof useCarouselSelection> | undefined;

    function Harness() {
      selection = useCarouselSelection({
        destinations,
        windowWidth: 390,
        carouselRef: { current: { scrollTo } } as never,
        mapRef: { current: { centerOn } } as never,
      });
      return null;
    }

    act(() => {
      create(React.createElement(Harness));
    });
    act(() => {
      selection?.setSelectedIndex(0);
    });

    act(() => {
      selection?.handleMomentumEnd({
        nativeEvent: { contentOffset: { x: 780 } },
      } as never);
    });
    expect(selection?.selectedIndex).toBe(0);

    act(() => {
      selection?.handleMomentumEnd({
        nativeEvent: { contentOffset: { x: 0 } },
      } as never);
    });
    expect(selection?.selectedIndex).toBe(0);
    expect(scrollTo).toHaveBeenCalledWith({ x: 0, animated: true });
  });

  it('updates selection and centers the map for a real swipe', () => {
    const centerOn = jest.fn();
    let selection: ReturnType<typeof useCarouselSelection> | undefined;

    function Harness() {
      selection = useCarouselSelection({
        destinations,
        windowWidth: 390,
        carouselRef: { current: null },
        mapRef: { current: { centerOn } } as never,
      });
      return null;
    }

    act(() => {
      create(React.createElement(Harness));
    });
    act(() => {
      selection?.handleScrollBeginDrag();
      selection?.handleMomentumEnd({
        nativeEvent: { contentOffset: { x: 390 } },
      } as never);
    });

    expect(selection?.selectedIndex).toBe(1);
    expect(centerOn).toHaveBeenCalledWith(destinations[1].coordinates);
  });
});
