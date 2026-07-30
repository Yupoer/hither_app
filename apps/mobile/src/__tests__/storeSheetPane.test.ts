import {
  COVERFLOW_ACTIVE_OFFSET_X,
  COVERFLOW_FAIL_OFFSET_Y,
  coverFlowHapticSteps,
  coverFlowSnapIndex,
  SHEET_ACTIVE_OFFSET_Y,
  SHEET_FAIL_OFFSET_X,
  tabScrollOffsetForSelection,
} from '../store/sheetPane';
import { SHEET_PANE_ORDER } from '../store/types';

describe('sheet pane order', () => {
  it('is fixed members → route → tools → store', () => {
    expect(SHEET_PANE_ORDER).toEqual(['members', 'route', 'tools', 'store']);
  });
});

describe('tabScrollOffsetForSelection', () => {
  it('keeps selected tab in a 3-slot viewport', () => {
    const tabWidth = 100;
    expect(
      tabScrollOffsetForSelection({
        selectedIndex: 0,
        tabWidth,
        viewportCount: 3,
        totalCount: 4,
      }),
    ).toBe(0);
    expect(
      tabScrollOffsetForSelection({
        selectedIndex: 3,
        tabWidth,
        viewportCount: 3,
        totalCount: 4,
      }),
    ).toBe(100);
    expect(
      tabScrollOffsetForSelection({
        selectedIndex: 1,
        tabWidth,
        viewportCount: 3,
        totalCount: 4,
      }),
    ).toBe(0);
  });
});

describe('coverFlowSnapIndex', () => {
  it('does not wrap at ends', () => {
    expect(coverFlowSnapIndex({
      currentIndex: 0, translationX: 100, itemCount: 4,
    })).toBe(0);
    expect(coverFlowSnapIndex({
      currentIndex: 3, translationX: -100, itemCount: 4,
    })).toBe(3);
  });

  it('moves next on left swipe and previous on right swipe', () => {
    expect(coverFlowSnapIndex({
      currentIndex: 0, translationX: -80, itemCount: 4,
    })).toBe(1);
    expect(coverFlowSnapIndex({
      currentIndex: 2, translationX: 80, itemCount: 4,
    })).toBe(1);
  });

  it('ignores sub-threshold and snaps reverse fling correctly', () => {
    expect(coverFlowSnapIndex({
      currentIndex: 1, translationX: -10, itemCount: 4,
    })).toBe(1);
    expect(coverFlowSnapIndex({
      currentIndex: 1, translationX: 10, velocityX: -900, itemCount: 4,
    })).toBe(2);
    expect(coverFlowSnapIndex({
      currentIndex: 1, translationX: -10, velocityX: 900, itemCount: 4,
    })).toBe(0);
  });

  it('can multi-step on long drag and reports haptic steps per index', () => {
    const next = coverFlowSnapIndex({
      currentIndex: 0, translationX: -200, itemCount: 4,
    });
    expect(next).toBeGreaterThan(1);
    expect(coverFlowHapticSteps(0, next)).toBe(next);
    expect(coverFlowHapticSteps(2, 2)).toBe(0);
  });
});

describe('exclusive gesture offset constants', () => {
  it('keeps CoverFlow X-active and sheet Y-active with cross-axis fail', () => {
    expect(COVERFLOW_ACTIVE_OFFSET_X).toBe(12);
    expect(COVERFLOW_FAIL_OFFSET_Y).toBe(14);
    expect(SHEET_FAIL_OFFSET_X).toBe(16);
    expect(SHEET_ACTIVE_OFFSET_Y).toBe(8);
    // Horizontal wins for CoverFlow before sheet activates on pure X.
    expect(COVERFLOW_ACTIVE_OFFSET_X).toBeLessThan(SHEET_FAIL_OFFSET_X + 8);
  });
});
