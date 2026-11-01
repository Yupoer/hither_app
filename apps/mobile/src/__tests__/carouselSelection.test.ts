import React from 'react';
import { act, create } from 'react-test-renderer';
import { useCarouselSelection } from '../screens/MapScreen/hooks/useCarouselSelection';
import type { Destination } from '../types';

jest.mock('../utils/activityLog', () => ({ logEvent: jest.fn() }));
jest.mock('../state/PreferencesContext', () => ({
  usePreferences: () => ({ travelMode: 'walk', setTravelMode: jest.fn() }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const destinations = ['a', 'b', 'c'].map((id, index) => ({
  id,
  title: id,
  order: index,
  day: 1,
  coordinates: { latitude: 25 + index, longitude: 121 },
})) as Destination[];

describe('useCarouselSelection', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
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
      return selection.lifecycle;
    }

    act(() => {
      create(React.createElement(Harness));
    });
    act(() => {
      selection?.handleScrollBeginDrag();
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
      return selection.lifecycle;
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
    expect(centerOn).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(140));
    expect(centerOn).toHaveBeenCalledWith(destinations[1].coordinates, { animated: false });
  });

  it('uses the 30-degree camera seam when oblique locating is enabled', () => {
    const focusOblique = jest.fn();
    let selection: ReturnType<typeof useCarouselSelection> | undefined;

    function Harness() {
      selection = useCarouselSelection({
        destinations,
        windowWidth: 390,
        carouselRef: { current: null },
        mapRef: { current: { centerOn: jest.fn(), focusOblique } } as never,
        obliqueLocate: true,
      });
      return selection.lifecycle;
    }

    act(() => { create(React.createElement(Harness)); });
    act(() => {
      selection?.handleScrollBeginDrag();
      selection?.handleMomentumEnd({
        nativeEvent: { contentOffset: { x: 390 } },
      } as never);
    });

    act(() => jest.advanceTimersByTime(140));
    expect(focusOblique).toHaveBeenCalledWith(destinations[1].coordinates, { animated: false });
  });

  it('keeps a flat center when oblique locating is disabled', () => {
    const centerOn = jest.fn();
    const focusOblique = jest.fn();
    let selection: ReturnType<typeof useCarouselSelection> | undefined;

    function Harness() {
      selection = useCarouselSelection({
        destinations,
        windowWidth: 390,
        carouselRef: { current: null },
        mapRef: { current: { centerOn, focusOblique } } as never,
        obliqueLocate: false,
      });
      return selection.lifecycle;
    }

    act(() => { create(React.createElement(Harness)); });
    act(() => {
      selection?.handleScrollBeginDrag();
      selection?.handleMomentumEnd({
        nativeEvent: { contentOffset: { x: 390 } },
      } as never);
    });

    act(() => jest.advanceTimersByTime(140));
    expect(centerOn).toHaveBeenCalledWith(destinations[1].coordinates, { animated: false });
    expect(focusOblique).not.toHaveBeenCalled();
  });

  it('coalesces rapid swipes while updating each selected card immediately', () => {
    const focusOblique = jest.fn();
    let selection: ReturnType<typeof useCarouselSelection> | undefined;
    function Harness() {
      selection = useCarouselSelection({ destinations, windowWidth: 390,
        carouselRef: { current: null }, mapRef: { current: { focusOblique } } as never });
      return selection.lifecycle;
    }
    let root: ReturnType<typeof create>;
    act(() => { root = create(React.createElement(Harness)); });
    act(() => {
      selection?.handleScrollBeginDrag();
      selection?.handleMomentumEnd({ nativeEvent: { contentOffset: { x: 390 } } } as never);
    });
    expect(selection?.selectedIndex).toBe(1);
    act(() => jest.advanceTimersByTime(80));
    act(() => selection?.handleScrollBeginDrag());
    act(() => jest.advanceTimersByTime(140));
    expect(focusOblique).not.toHaveBeenCalled();
    act(() => selection?.handleMomentumEnd({ nativeEvent: { contentOffset: { x: 780 } } } as never));
    expect(selection?.selectedIndex).toBe(2);
    act(() => jest.advanceTimersByTime(140));
    expect(focusOblique).toHaveBeenCalledTimes(1);
    expect(focusOblique).toHaveBeenCalledWith(destinations[2].coordinates, { animated: false });
    act(() => root!.unmount());
  });

  it('preserves a manually panned map after a swipe lands on the already focused card', () => {
    const focusOblique = jest.fn();
    let selection: ReturnType<typeof useCarouselSelection> | undefined;
    function Harness() {
      selection = useCarouselSelection({ destinations, windowWidth: 390,
        carouselRef: { current: null }, mapRef: { current: { focusOblique } } as never });
      return selection.lifecycle;
    }
    let root: ReturnType<typeof create>;
    act(() => { root = create(React.createElement(Harness)); });
    act(() => {
      selection?.handleScrollBeginDrag();
      selection?.handleMomentumEnd({ nativeEvent: { contentOffset: { x: 390 } } } as never);
    });
    act(() => jest.advanceTimersByTime(140));
    focusOblique.mockClear();
    act(() => {
      selection?.handleScrollBeginDrag();
      selection?.handleMomentumEnd({ nativeEvent: { contentOffset: { x: 390 } } } as never);
    });
    act(() => jest.advanceTimersByTime(140));
    expect(focusOblique).not.toHaveBeenCalled();
    act(() => root!.unmount());
  });

  it('resumes an interrupted focus when the next drag lands on the same selected card', () => {
    const focusOblique = jest.fn();
    let selection: ReturnType<typeof useCarouselSelection> | undefined;
    function Harness() {
      selection = useCarouselSelection({ destinations, windowWidth: 390,
        carouselRef: { current: null }, mapRef: { current: { focusOblique } } as never });
      return selection.lifecycle;
    }
    let root: ReturnType<typeof create>;
    act(() => { root = create(React.createElement(Harness)); });
    act(() => {
      selection?.handleScrollBeginDrag();
      selection?.handleMomentumEnd({ nativeEvent: { contentOffset: { x: 390 } } } as never);
    });
    act(() => jest.advanceTimersByTime(80));
    act(() => selection?.handleScrollBeginDrag());
    act(() => jest.advanceTimersByTime(140));
    expect(focusOblique).not.toHaveBeenCalled();
    act(() => selection?.handleMomentumEnd({ nativeEvent: { contentOffset: { x: 390 } } } as never));
    act(() => jest.advanceTimersByTime(140));
    expect(focusOblique).toHaveBeenCalledTimes(1);
    expect(focusOblique).toHaveBeenCalledWith(destinations[1].coordinates, { animated: false });
    act(() => root!.unmount());
  });

  it('invalidates pending cameras on programmatic selection, destination replacement, removal and unmount', () => {
    const focusOblique = jest.fn();
    let selection: ReturnType<typeof useCarouselSelection> | undefined;
    function Harness({ points }: { points: Destination[] }) {
      selection = useCarouselSelection({ destinations: points, windowWidth: 390,
        carouselRef: { current: null }, mapRef: { current: { focusOblique } } as never });
      return selection.lifecycle;
    }
    let root: ReturnType<typeof create>;
    act(() => { root = create(React.createElement(Harness, { points: destinations })); });
    const swipe = (index: number) => act(() => {
      selection?.handleScrollBeginDrag();
      selection?.handleMomentumEnd({ nativeEvent: { contentOffset: { x: index * 390 } } } as never);
    });
    const settleWithoutCamera = () => {
      act(() => jest.advanceTimersByTime(140));
      expect(focusOblique).not.toHaveBeenCalled();
    };
    swipe(1);
    act(() => selection?.setSelectedIndex(1));
    settleWithoutCamera();
    swipe(2);
    const replaced = destinations.map((point, index) => index === 2 ? { ...point, id: 'replacement' } : point);
    act(() => root!.update(React.createElement(Harness, { points: replaced })));
    settleWithoutCamera();
    swipe(1);
    act(() => root!.update(React.createElement(Harness, { points: [destinations[0]] })));
    settleWithoutCamera();
    act(() => root!.update(React.createElement(Harness, { points: destinations })));
    swipe(1);
    act(() => root!.unmount());
    settleWithoutCamera();
  });
});
