import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { advanceRouteToCoordinate } from '../utils/advanceRouteToCoordinate';
import { distanceMeters } from '../utils/geo';

const groupMap = readFileSync(join(__dirname, '..', 'components', 'GroupMap.tsx'), 'utf8');

const a = { latitude: 25.03, longitude: 121.56 };
const b = { latitude: 25.031, longitude: 121.56 };
const c = { latitude: 25.032, longitude: 121.56 };
const d = { latitude: 25.032, longitude: 121.561 };
const line = [a, b, c];

describe('advanceRouteToCoordinate', () => {
  it('returns empty for an empty polyline', () => {
    expect(advanceRouteToCoordinate([], a)).toEqual([]);
  });

  it('splices the current GPS onto the remaining polyline without waiting for network', () => {
    const mid = { latitude: 25.0304, longitude: 121.56 };
    const advanced = advanceRouteToCoordinate(line, mid);
    expect(advanced[0]).toEqual(mid);
    expect(advanced[advanced.length - 1]).toEqual(c);
    expect(advanced.some((p) => p.latitude === a.latitude && p.longitude === a.longitude)).toBe(false);
    expect(distanceMeters(advanced[0]!, mid)).toBe(0);
  });

  it('keeps the U-turn tail after projecting onto the nearest forward segment', () => {
    const uTurn = [a, b, c, d];
    const nearC = { latitude: 25.0318, longitude: 121.56 };
    const advanced = advanceRouteToCoordinate(uTurn, nearC);
    expect(advanced[0]).toEqual(nearC);
    expect(advanced[advanced.length - 1]).toEqual(d);
  });

  it('clears the line after the destination is passed', () => {
    const past = { latitude: 25.0322, longitude: 121.56 };
    expect(advanceRouteToCoordinate(line, past)).toEqual([]);
  });

  it('trims on the map surface before LOD and does not add a native module', () => {
    expect(groupMap).toContain('advanceRouteToCoordinate');
    expect(groupMap).toContain('displayRoutePoints');
    expect(groupMap.indexOf('advanceRouteToCoordinate')).toBeLessThan(
      groupMap.indexOf('displayRoutePoints('),
    );
    expect(groupMap).not.toContain('requireOptionalNativeModule');
  });
});
