import {
  ARRIVAL_RADIUS_M,
  hasArrived,
  initialJourneyDistance,
  journeyProgress,
} from '../utils/journeyProgress';

describe('journey arrival boundary', () => {
  it.each([
    [29.99, true],
    [30, true],
    [30.01, false],
  ])('treats %s metres as arrived=%s', (distance, expected) => {
    expect(hasArrived(distance)).toBe(expected);
  });

  it('keeps the approved radius at exactly 30 metres', () => {
    expect(ARRIVAL_RADIUS_M).toBe(30);
  });
});

describe('personal journey progress', () => {
  it('prefers MapKit route distance for the initial distance', () => {
    expect(initialJourneyDistance(1200, 900)).toBe(1200);
  });

  it('falls back to straight-line distance when MapKit has no route', () => {
    expect(initialJourneyDistance(undefined, 900)).toBe(900);
  });

  it('uses the member own initial and current distance', () => {
    expect(journeyProgress(1000, 250)).toBeCloseTo(0.75);
  });

  it('clamps movement away from the destination to zero', () => {
    expect(journeyProgress(1000, 1200)).toBe(0);
  });

  it('clamps a passed destination to complete', () => {
    expect(journeyProgress(1000, -1)).toBe(1);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'returns zero for invalid initial distance %s',
    (initialDistance) => {
      expect(journeyProgress(initialDistance, 10)).toBe(0);
    },
  );
});
