import { locationPolicy, shouldWatchLocation } from '../utils/locationPolicy';

describe('locationPolicy', () => {
  it('defaults to the low-power profile', () => {
    expect(locationPolicy(false)).toEqual({
      accuracy: 'balanced',
      distanceInterval: 50,
      timeInterval: 30_000,
    });
  });

  it('uses the faster high-accuracy profile only when enabled', () => {
    expect(locationPolicy(true)).toEqual({
      accuracy: 'high',
      distanceInterval: 10,
      timeInterval: 5_000,
    });
  });
});

describe('shouldWatchLocation', () => {
  it('watches only for an active app with a group', () => {
    expect(shouldWatchLocation('group-1', 'active')).toBe(true);
    expect(shouldWatchLocation('group-1', 'background')).toBe(false);
    expect(shouldWatchLocation('group-1', 'inactive')).toBe(false);
    expect(shouldWatchLocation(null, 'active')).toBe(false);
  });
});
