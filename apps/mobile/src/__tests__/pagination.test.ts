import { dotWindow } from '../utils/pagination';

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
});
