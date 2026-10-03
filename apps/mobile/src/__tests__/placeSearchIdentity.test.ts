jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => null }));
jest.mock('../native/googleMapsProxy', () => ({
  MapsProxyError: class MapsProxyError extends Error {},
  proxySearchPlaces: jest.fn(async () => null), proxyGetDirections: jest.fn(),
}));
import { searchPlaces } from '../native/maps';
import { normalizePlaceSearchResults, placeSearchResultKey } from '../utils/normalizePlaceSearchResults';

it('normalizes actual Photon duplicates without merging different locations or provider identities', async () => {
  const originalFetch = global.fetch;
  const features = [
    { properties: { osm_id: 55441040, osm_type: 'W', name: 'Station' }, geometry: { coordinates: [139, 35] } },
    { properties: { osm_id: 55441040, osm_type: 'W', name: 'Station duplicate' }, geometry: { coordinates: [139, 35] } },
    { properties: { osm_id: 55441040, osm_type: 'W', name: 'Station east' }, geometry: { coordinates: [139.01, 35] } },
    { properties: { osm_id: 55441040, osm_type: 'N', name: 'Nearby distinct POI' }, geometry: { coordinates: [139, 35] } },
  ];
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ features }) })) as unknown as typeof fetch;
  try {
    const results = await searchPlaces('Station');
    expect(results.map(place => place.name)).toEqual(['Station', 'Station east', 'Nearby distinct POI']);
    expect(results.map(place => place.id)).toEqual(['W55441040', 'W55441040', 'N55441040']);
    expect(new Set(results.map(placeSearchResultKey)).size).toBe(3);
    expect(normalizePlaceSearchResults([...results].reverse()).map(placeSearchResultKey))
      .toEqual(results.map(placeSearchResultKey).reverse());
    expect(global.fetch).toHaveBeenCalledTimes(1);
  } finally { global.fetch = originalFetch; }
});

it('keeps exact locations distinct without coordinate rounding or delimiter collisions', () => {
  const places = [
    { id: 'W:35,139', name: 'A', coordinates: { latitude: 35, longitude: 139 } },
    { id: 'W:35,139', name: 'B', coordinates: { latitude: 35.00000001, longitude: 139 } },
  ];
  expect(normalizePlaceSearchResults(places)).toEqual(places);
  expect(new Set(places.map(placeSearchResultKey)).size).toBe(2);
});
