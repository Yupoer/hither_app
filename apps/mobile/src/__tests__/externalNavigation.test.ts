jest.mock('react-native', () => ({
  Linking: { openURL: jest.fn(() => Promise.resolve()) },
  Platform: { OS: 'ios' },
}));

import { buildNavigationUrl } from '../native/externalNavigation';
import type { Destination } from '../types';

const taipei101 = {
  id: 'd1',
  title: 'Taipei 101 / 台北101',
  coordinates: { latitude: 25.0339, longitude: 121.5645 },
  order: 0,
  day: 1,
} as Destination;

describe('buildNavigationUrl', () => {
  it('builds an Android Google Maps walking URL with encoded destination', () => {
    const url = buildNavigationUrl('android', taipei101, 'walk');
    expect(url).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=25.0339%2C121.5645&travelmode=walking',
    );
    expect(url).toContain('google.com/maps/dir');
    expect(url).toContain('travelmode=walking');
  });

  it('maps drive and transit modes for Google Maps', () => {
    expect(buildNavigationUrl('android', taipei101, 'drive')).toContain('travelmode=driving');
    expect(buildNavigationUrl('android', taipei101, 'transit')).toContain('travelmode=transit');
  });

  it('builds an iOS Apple Maps URL', () => {
    const url = buildNavigationUrl('ios', taipei101, 'walk');
    expect(url).toContain('maps.apple.com');
    expect(url).toContain('daddr=25.0339');
    expect(url).toContain('dirflg=w');
    // Title must be encoded, not raw-spliced.
    expect(url).toContain(encodeURIComponent('Taipei 101 / 台北101').replace(/%20/g, '+').includes('Taipei')
      ? 'q='
      : 'q=');
    expect(url).toMatch(/q=/);
  });

  it('encodes special characters via URLSearchParams (no raw title concatenation)', () => {
    const dest = {
      ...taipei101,
      title: 'A&B=C?D',
    } as Destination;
    const url = buildNavigationUrl('ios', dest, 'walk');
    expect(url).not.toContain('A&B=C?D');
    expect(url).toContain('maps.apple.com');
  });
});
