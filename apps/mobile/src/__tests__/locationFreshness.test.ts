import {
  locationFreshness,
  resolveSelfAwareLastUpdated,
  isLocationSampleFresh,
  locationFreshnessLimitMs,
} from '../utils/locationFreshness';

const NOW = Date.parse('2026-07-13T12:00:00.000Z');

describe('sample metadata freshness allowance', () => {
  const presence = { locationTrackingMode: 'passiveBackground', locationSource: 'background_task',
    locationNavigationSessionId: null };
  it.each([[119_999, true, true], [120_000, true, false], [150_000, true, false],
    [179_999, true, false], [180_000, false, false]])('preserves capture age %sms across presence and journey', (age, passiveFresh, journeyFresh) => {
    const timestamp = new Date(NOW - (age as number)).toISOString();
    expect(isLocationSampleFresh(timestamp, presence, NOW)).toBe(passiveFresh);
    expect(isLocationSampleFresh(timestamp, { ...presence, locationTrackingMode: 'navigationMax',
      locationNavigationSessionId: 'session-1' }, NOW)).toBe(journeyFresh);
    expect(locationFreshness(timestamp, NOW)).toEqual(age as number < 120_000
      ? { unit: 'minutes', value: 1 } : { unit: 'minutes', value: Math.floor((age as number) / 60_000) });
  });
  it.each([{}, { ...presence, locationSource: 'refresh_request' },
    { ...presence, locationTrackingMode: 'manualHighAccuracy' },
    { ...presence, locationNavigationSessionId: 'session-1' },
    { ...presence, locationNavigationSessionId: undefined }])('does not assume a passive cadence without exact metadata: %j', metadata => {
    expect(locationFreshnessLimitMs(metadata)).toBe(120_000);
    expect(isLocationSampleFresh(new Date(NOW - 150_000).toISOString(), metadata, NOW)).toBe(false);
  });
  it('rejects absent or invalid timestamps and samples beyond the ingestion clock tolerance', () => {
    expect(isLocationSampleFresh(undefined, presence, NOW)).toBe(false);
    expect(isLocationSampleFresh('invalid', presence, NOW)).toBe(false);
    expect(isLocationSampleFresh(new Date(NOW + 120_001).toISOString(), presence, NOW)).toBe(false);
  });
});

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

  it('keeps reporting concrete hours after 24 hours', () => {
    expect(locationFreshness('2026-07-12T12:00:00.000Z', NOW)).toEqual({
      unit: 'hours',
      value: 24,
    });
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
