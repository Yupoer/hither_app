import {
  isHorizontalPaneGesture,
  paneAfterSwipe,
  paneAt,
  paneIndex,
  tabScrollOffsetForSelection,
} from '../store/sheetPane';
import { SHEET_PANE_ORDER } from '../store/types';

describe('sheet pane order', () => {
  it('is fixed members → route → tools → store', () => {
    expect(SHEET_PANE_ORDER).toEqual(['members', 'route', 'tools', 'store']);
    expect(paneIndex('store')).toBe(3);
    expect(paneAt(0)).toBe('members');
    expect(paneAt(4)).toBeNull();
  });
});

describe('paneAfterSwipe', () => {
  it('does not wrap at ends', () => {
    expect(paneAfterSwipe('members', 100)).toBe('members');
    expect(paneAfterSwipe('store', -100)).toBe('store');
  });

  it('moves next on left swipe and previous on right swipe', () => {
    expect(paneAfterSwipe('members', -80)).toBe('route');
    expect(paneAfterSwipe('route', -80)).toBe('tools');
    expect(paneAfterSwipe('tools', -80)).toBe('store');
    expect(paneAfterSwipe('store', 80)).toBe('tools');
  });

  it('ignores sub-threshold swipes', () => {
    expect(paneAfterSwipe('route', -10)).toBe('route');
  });
});

describe('isHorizontalPaneGesture', () => {
  it('requires dominant horizontal movement', () => {
    expect(isHorizontalPaneGesture(60, 10)).toBe(true);
    expect(isHorizontalPaneGesture(60, 80)).toBe(false);
    expect(isHorizontalPaneGesture(20, 5)).toBe(false);
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
