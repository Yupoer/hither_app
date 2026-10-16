import {
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

describe('sheet gesture offset constants', () => {
  it('keeps sheet Y-active with cross-axis fail', () => {
    expect(SHEET_FAIL_OFFSET_X).toBe(16);
    expect(SHEET_ACTIVE_OFFSET_Y).toBe(8);
  });
});
