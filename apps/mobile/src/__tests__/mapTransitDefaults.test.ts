const platform = { OS: 'ios' as 'ios' | 'android' | 'web' };

jest.mock('react-native', () => ({ Platform: platform }));

import { APPLE_TRANSIT_POI_FILTER, defaultMapTransitProps } from '../native/mapTransitDefaults';

describe('defaultMapTransitProps', () => {
  afterEach(() => {
    platform.OS = 'ios';
  });

  it('uses an exclusive Apple transit POI filter on iOS', () => {
    platform.OS = 'ios';
    expect(defaultMapTransitProps()).toEqual({
      showsPointsOfInterests: true,
      showsBuildings: false,
      pointsOfInterestFilter: APPLE_TRANSIT_POI_FILTER,
    });
    expect(APPLE_TRANSIT_POI_FILTER).toContain('publicTransport');
  });

  it('keeps Android showsTransit', () => {
    platform.OS = 'android';
    expect(defaultMapTransitProps()).toEqual({ showsTransit: true });
  });

  it('fails closed on unsupported platforms', () => {
    platform.OS = 'web';
    expect(defaultMapTransitProps()).toEqual({});
  });
});
