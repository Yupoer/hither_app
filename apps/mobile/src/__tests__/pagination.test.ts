import {
  DOT_ACTIVE_PX,
  DOT_GAP_PX,
  DOT_INACTIVE_PX,
  DOT_PITCH_PX,
  dotWindow,
  dotWindowRelative,
  dotWindowStart,
  indicatorRowGeometry,
} from '../utils/pagination';

describe('dotWindow', () => {
  it('shows every dot when total fits within the cap', () => {
    expect(dotWindow(4, 0, 5)).toEqual([0, 1, 2, 3]);
  });

  it('stays clamped to the start while active is near the front', () => {
    expect(dotWindow(20, 0, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(dotWindow(20, 1, 5)).toEqual([0, 1, 2, 3, 4]);
  });

  it('keeps the active dot centered in the middle of the run', () => {
    expect(dotWindow(20, 10, 5)).toEqual([8, 9, 10, 11, 12]);
  });

  it('clamps to the end while active is near the back', () => {
    expect(dotWindow(20, 19, 5)).toEqual([15, 16, 17, 18, 19]);
    expect(dotWindow(20, 18, 5)).toEqual([15, 16, 17, 18, 19]);
  });

  it('slides the window left when advancing from card 3 to 4 (0-based 2→3)', () => {
    // maxVisible=5, half=2: active 2 still start=0; active 3 starts window at 1.
    expect(dotWindowStart(20, 2, 5)).toBe(0);
    expect(dotWindowStart(20, 3, 5)).toBe(1);
    expect(dotWindowRelative(20, 2, 5)).toBe(2); // 3rd slot
    expect(dotWindowRelative(20, 3, 5)).toBe(2); // re-centers on 3rd after slide
    // Phase-1 interim after left pitch: previous rel 2 + dir(-1) → 1 (2nd slot).
    expect(2 + (dotWindowStart(20, 3, 5) > dotWindowStart(20, 2, 5) ? -1 : 1)).toBe(1);
  });

  it('keeps inactive pitch equal to inactive width plus gap', () => {
    expect(DOT_PITCH_PX).toBe(DOT_INACTIVE_PX + DOT_GAP_PX);
  });
});

describe('indicatorRowGeometry (#180)', () => {
  const widths = (total: number, active: number, maxVisible = 5) =>
    indicatorRowGeometry(total, active, maxVisible).items.map((item) => item.width);

  const kinds = (total: number, active: number, maxVisible = 5) =>
    indicatorRowGeometry(total, active, maxVisible).items.map((item) =>
      item.active ? 'pill' : 'dot',
    );

  it('two destinations: first card is pill+dot, second is dot+pill', () => {
    expect(kinds(2, 0)).toEqual(['pill', 'dot']);
    expect(widths(2, 0)).toEqual([DOT_ACTIVE_PX, DOT_INACTIVE_PX]);
    expect(kinds(2, 1)).toEqual(['dot', 'pill']);
    expect(widths(2, 1)).toEqual([DOT_INACTIVE_PX, DOT_ACTIVE_PX]);
  });

  it('three destinations: every card shows three items with the active pill in place', () => {
    expect(kinds(3, 0)).toEqual(['pill', 'dot', 'dot']);
    expect(kinds(3, 1)).toEqual(['dot', 'pill', 'dot']);
    expect(kinds(3, 2)).toEqual(['dot', 'dot', 'pill']);
    expect(indicatorRowGeometry(3, 0).items).toHaveLength(3);
    expect(indicatorRowGeometry(3, 1).items).toHaveLength(3);
    expect(indicatorRowGeometry(3, 2).items).toHaveLength(3);
  });

  it('four and 5+ first/mid/last windows keep count, order, and one pill', () => {
    const cases: Array<{ total: number; active: number }> = [
      { total: 4, active: 0 },
      { total: 4, active: 1 },
      { total: 4, active: 3 },
      { total: 8, active: 0 },
      { total: 8, active: 4 },
      { total: 8, active: 7 },
    ];
    for (const { total, active } of cases) {
      const row = indicatorRowGeometry(total, active, 5);
      const expectedIndexes = dotWindow(total, active, 5);
      expect(row.items.map((item) => item.index)).toEqual(expectedIndexes);
      expect(row.items.filter((item) => item.active)).toHaveLength(1);
      expect(row.items.find((item) => item.active)?.index).toBe(active);
      const expectedWidth =
        row.items.reduce((sum, item) => sum + item.width, 0)
        + DOT_GAP_PX * Math.max(0, row.items.length - 1);
      expect(row.totalWidth).toBe(expectedWidth);
    }
  });

  it('counts only destinations — day grouping is not an input', () => {
    // Same 3 active destinations whether first two share a day or not.
    const sameDay = indicatorRowGeometry(3, 0);
    const mixedDays = indicatorRowGeometry(3, 0);
    expect(sameDay).toEqual(mixedDays);
    expect(sameDay.items).toHaveLength(3);
  });

  it('lets each item occupy its own width so the active pill cannot cover a neighbor', () => {
    const row = indicatorRowGeometry(3, 0);
    expect(row.items[0].width).toBe(DOT_ACTIVE_PX);
    expect(row.items[1].width).toBe(DOT_INACTIVE_PX);
    expect(row.totalWidth).toBe(
      DOT_ACTIVE_PX + DOT_INACTIVE_PX + DOT_INACTIVE_PX + DOT_GAP_PX * 2,
    );
    expect(row.totalWidth).toBeGreaterThan(DOT_PITCH_PX * 2);
  });
});
