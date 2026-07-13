import { locationFreshness } from '../utils/locationFreshness';

const NOW = Date.parse('2026-07-13T12:00:00.000Z');

describe('locationFreshness', () => {
  it('reports a missing update', () => {
    expect(locationFreshness(undefined, NOW)).toEqual({ unit: 'missing' });
  });

  it('reports just now for updates under one minute old', () => {
    expect(locationFreshness('2026-07-13T11:59:30.000Z', NOW)).toEqual({ unit: 'justNow' });
  });

  it('reports completed minutes and hours', () => {
    expect(locationFreshness('2026-07-13T11:57:00.000Z', NOW)).toEqual({
      unit: 'minutes',
      value: 3,
    });
    expect(locationFreshness('2026-07-13T10:00:00.000Z', NOW)).toEqual({
      unit: 'hours',
      value: 2,
    });
  });

  it('stops counting after 24 hours', () => {
    expect(locationFreshness('2026-07-12T12:00:00.000Z', NOW)).toEqual({ unit: 'stale' });
    expect(locationFreshness('not-a-date', NOW)).toEqual({ unit: 'missing' });
  });
});
