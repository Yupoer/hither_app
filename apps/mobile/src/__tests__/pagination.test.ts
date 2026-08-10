import {
  DOT_PITCH_PX,
  dotWindow,
  dotWindowRelative,
  dotWindowStart,
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

  it('exports a positive strip pitch for slide animation', () => {
    expect(DOT_PITCH_PX).toBeGreaterThan(0);
  });
});
