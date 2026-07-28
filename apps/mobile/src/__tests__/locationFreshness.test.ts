import {
  locationFreshness,
  resolveSelfAwareLastUpdated,
} from '../utils/locationFreshness';

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

describe('resolveSelfAwareLastUpdated', () => {
  it('prefers local self sample when remote is missing', () => {
    const iso = resolveSelfAwareLastUpdated({
      isSelf: true,
      remoteLastUpdated: undefined,
      selfSampleAtMs: NOW,
    });
    expect(iso).toBe(new Date(NOW).toISOString());
    expect(locationFreshness(iso, NOW)).toEqual({ unit: 'justNow' });
  });

  it('does not invent a timestamp for other members', () => {
    expect(
      resolveSelfAwareLastUpdated({
        isSelf: false,
        remoteLastUpdated: undefined,
        selfSampleAtMs: NOW,
      }),
    ).toBeUndefined();
  });

  it('keeps the fresher of remote and local self sample', () => {
    const olderRemote = '2026-07-13T11:00:00.000Z';
    const newerLocal = Date.parse('2026-07-13T11:55:00.000Z');
    expect(
      resolveSelfAwareLastUpdated({
        isSelf: true,
        remoteLastUpdated: olderRemote,
        selfSampleAtMs: newerLocal,
      }),
    ).toBe(new Date(newerLocal).toISOString());

    const newerRemote = '2026-07-13T11:59:00.000Z';
    const olderLocal = Date.parse('2026-07-13T11:00:00.000Z');
    expect(
      resolveSelfAwareLastUpdated({
        isSelf: true,
        remoteLastUpdated: newerRemote,
        selfSampleAtMs: olderLocal,
      }),
    ).toBe(newerRemote);
  });
});
