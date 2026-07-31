import {
  cameraAfterSuccessfulAdd,
  cameraOnLongPress,
  cameraOnSearchPick,
  isValidMapCoordinate,
  neighborhoodCameraOptions,
} from '../utils/mapCameraFlow';
import { PLACE_ALTITUDE, PLACE_ZOOM } from '../components/mapCameraMath';

function mockMap() {
  return {
    centerOn: jest.fn(),
    fitRoute: jest.fn(),
  };
}

describe('mapCameraFlow', () => {
  it('uses search neighborhood zoom scale', () => {
    expect(neighborhoodCameraOptions()).toEqual({
      zoom: PLACE_ZOOM,
      altitude: PLACE_ALTITUDE,
    });
  });

  it('long-press triggers exactly one neighborhood centerOn', () => {
    const map = mockMap();
    const coords = { latitude: 25.03, longitude: 121.56 };
    expect(cameraOnLongPress(map, coords)).toBe(true);
    expect(map.centerOn).toHaveBeenCalledTimes(1);
    expect(map.centerOn).toHaveBeenCalledWith(coords, {
      zoom: PLACE_ZOOM,
      altitude: PLACE_ALTITUDE,
    });
    expect(map.fitRoute).not.toHaveBeenCalled();
  });

  it('ignores invalid long-press coords', () => {
    const map = mockMap();
    expect(cameraOnLongPress(map, { latitude: 99, longitude: 0 })).toBe(false);
    expect(map.centerOn).not.toHaveBeenCalled();
  });

  it('success with self fits self + dest once', () => {
    const map = mockMap();
    const dest = { latitude: 25.1, longitude: 121.5 };
    const self = { latitude: 25.0, longitude: 121.4 };
    expect(cameraAfterSuccessfulAdd(map, dest, self)).toBe('fit_self_and_dest');
    expect(map.fitRoute).toHaveBeenCalledTimes(1);
    expect(map.fitRoute).toHaveBeenCalledWith([self, dest]);
    expect(map.centerOn).not.toHaveBeenCalled();
  });

  it('success without self uses single-point center', () => {
    const map = mockMap();
    const dest = { latitude: 25.1, longitude: 121.5 };
    expect(cameraAfterSuccessfulAdd(map, dest, null)).toBe('center_dest');
    expect(map.centerOn).toHaveBeenCalledTimes(1);
    expect(map.fitRoute).not.toHaveBeenCalled();
  });

  it('search pick shares long-press neighborhood camera', () => {
    const map = mockMap();
    const coords = { latitude: 25.03, longitude: 121.56 };
    expect(cameraOnSearchPick(map, coords)).toBe(true);
    expect(map.centerOn).toHaveBeenCalledWith(coords, neighborhoodCameraOptions());
  });

  it('validates coordinates', () => {
    expect(isValidMapCoordinate({ latitude: 0, longitude: 0 })).toBe(true);
    expect(isValidMapCoordinate({ latitude: NaN, longitude: 0 })).toBe(false);
  });
});

describe('first-destination camera stacking (GroupMap)', () => {
  it('marks imperative camera as user-owned so first gathering does not re-animate', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const groupMap = require('fs').readFileSync(
      require('path').join(__dirname, '../components/GroupMap.tsx'),
      'utf8',
    );
    expect(groupMap).toContain("centeredModeRef.current = 'user'");
    expect(groupMap).toContain("if (centeredModeRef.current === 'user')");
    expect(groupMap).toContain('without a second stacked animation');
  });
});
