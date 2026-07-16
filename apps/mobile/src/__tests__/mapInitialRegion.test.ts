import { DEFAULT_MAP_CENTER, initialRegionFor } from '../components/mapCameraMath';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const groupMap = readFileSync(join(__dirname, '../components/GroupMap.tsx'), 'utf8');

describe('GroupMap initial region', () => {
  it('always provides a valid camera when a new group has no gathering point yet', () => {
    expect(initialRegionFor(undefined)).toEqual({
      latitude: DEFAULT_MAP_CENTER.latitude,
      longitude: DEFAULT_MAP_CENTER.longitude,
      latitudeDelta: expect.any(Number),
      longitudeDelta: expect.any(Number),
    });
  });

  it('uses the first available user location before the first gathering point', () => {
    const region = initialRegionFor({ latitude: 24.998, longitude: 121.456 }, 0.002);
    expect(region.latitude).toBeCloseTo(24.996);
    expect(region).toMatchObject({
      longitude: 121.456,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    });
  });

  it('does not pass an undefined initial region to the native map', () => {
    expect(groupMap).toContain('initialRegion={mapInitialRegion}');
    expect(groupMap).not.toContain('initialRegion={gathering ?');
  });
});
