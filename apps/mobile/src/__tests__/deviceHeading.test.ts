import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const groupMap = readFileSync(join(__dirname, '../components/GroupMap.tsx'), 'utf8');
const maps = readFileSync(join(__dirname, '../native/maps.ts'), 'utf8');
const nativeMapsPatch = readFileSync(
  join(__dirname, '../../node_modules/react-native-maps/ios/AirMaps/AIRMap.mm'),
  'utf8',
);

describe('native iOS heading indicator contract', () => {
  it('keeps heading updates out of the React render tree', () => {
    expect(groupMap).not.toContain('selfHeading');
    expect(groupMap).not.toContain('HeadingMarker');
    expect(groupMap).toContain('headingEnabled: showsUserLocation && appActive');
    expect(maps).toContain('showsUserHeadingIndicator');
  });

  it('uses CoreLocation true-heading fallback, 5 degree filtering, and lifecycle stop', () => {
    expect(nativeMapsPatch).toContain('CLLocationManager');
    expect(nativeMapsPatch).toContain('headingFilter = 5.0');
    expect(nativeMapsPatch).toContain('newHeading.trueHeading >= 0');
    expect(nativeMapsPatch).toContain('newHeading.magneticHeading');
    expect(nativeMapsPatch).toContain('UIApplicationDidEnterBackgroundNotification');
    expect(nativeMapsPatch).toContain('self.hitherHeading - self.camera.heading');
  });
});
