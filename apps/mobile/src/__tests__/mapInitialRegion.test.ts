import { DEFAULT_MAP_CENTER, cameraCenterForTarget, initialRegionFor, latOffsetForVisibleBand } from '../components/mapCameraMath';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const groupMap = readFileSync(join(__dirname, '../components/GroupMap.tsx'), 'utf8');

describe('GroupMap initial region', () => {
  it('keeps a target in the visible band as top and bottom chrome change', () => {
    expect(latOffsetForVisibleBand(0.01, 120, 360, 800)).toBeCloseTo(0.0015);
    expect(latOffsetForVisibleBand(0.01, 360, 120, 800)).toBeCloseTo(-0.0015);
    expect(latOffsetForVisibleBand(0.01, 120, 120, 800)).toBe(0);
    expect(latOffsetForVisibleBand(0.01, 120, 360, 0)).toBe(0);
  });
  it('positions a target using the native projected point rather than an assumed map span', () => {
    const camera = { latitude: 25, longitude: 121 };
    const target = { latitude: 24.98, longitude: 121.03 };
    const center = cameraCenterForTarget(camera, target, { latitude: 25.015, longitude: 121.005 });
    expect(center.latitude).toBeCloseTo(24.965);
    expect(center.longitude).toBeCloseTo(121.025);
    const unchanged = cameraCenterForTarget(camera, target, target);
    expect(unchanged.latitude).toBeCloseTo(camera.latitude);
    expect(unchanged.longitude).toBeCloseTo(camera.longitude);
  });
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
