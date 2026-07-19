import {
  ARRIVAL_RADIUS_OPTIONS,
  clampArrivalRadiusM,
  DEFAULT_ARRIVAL_RADIUS_M,
} from '../state/PreferencesContext';

describe('arrival radius detents', () => {
  it('exposes the four supported radii', () => {
    expect(ARRIVAL_RADIUS_OPTIONS).toEqual([30, 50, 100, 300]);
  });

  it('keeps exact detents', () => {
    expect(clampArrivalRadiusM(30)).toBe(30);
    expect(clampArrivalRadiusM(50)).toBe(50);
    expect(clampArrivalRadiusM(100)).toBe(100);
    expect(clampArrivalRadiusM(300)).toBe(300);
  });

  it('snaps legacy continuous values to the nearest option', () => {
    expect(clampArrivalRadiusM(87)).toBe(100);
    expect(clampArrivalRadiusM(220)).toBe(300);
    expect(clampArrivalRadiusM(10)).toBe(30);
  });

  it('chooses the lower detent on exact midpoints', () => {
    // Midpoint 75 between 50 and 100 → lower 50.
    expect(clampArrivalRadiusM(75)).toBe(50);
    // Midpoint 200 between 100 and 300 → lower 100.
    expect(clampArrivalRadiusM(200)).toBe(100);
  });

  it('falls back to the default for non-finite input', () => {
    expect(clampArrivalRadiusM(Number.NaN)).toBe(50);
    expect(clampArrivalRadiusM(Number.POSITIVE_INFINITY)).toBe(DEFAULT_ARRIVAL_RADIUS_M);
  });
});
