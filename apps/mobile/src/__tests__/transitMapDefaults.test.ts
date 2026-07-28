import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../..');
const groupMap = readFileSync(join(__dirname, '../components/GroupMap.tsx'), 'utf8');
const mapsBoundary = readFileSync(join(__dirname, '../native/maps.ts'), 'utf8');
const mapsModuleIos = readFileSync(
  join(__dirname, '../../modules/hither-maps/ios/HitherMapsModule.swift'),
  'utf8',
);
const packageJson = readFileSync(join(root, 'package.json'), 'utf8');

describe('transit-oriented map defaults', () => {
  it('puts platform transit selection in the native maps boundary', () => {
    expect(mapsBoundary).toContain('export function defaultMapTransitProps');
    expect(mapsBoundary).toContain("Platform.OS === 'android'");
    expect(mapsBoundary).toContain('showsTransit: true');
    expect(mapsBoundary).toContain('showsPointsOfInterests: true');
    // UI consumes the boundary helper — no new Platform.OS transit branch in GroupMap.
    expect(groupMap).toContain('defaultMapTransitProps');
    expect(groupMap).not.toMatch(/Platform\.OS === ['"]android['"]\s*\n\s*\? \(\{ showsTransit/);
  });

  it('keeps showsTransit durable via patch-package and Maps SDK 20+', () => {
    expect(packageJson).toContain('patch-package');
    expect(packageJson).toContain('"postinstall": "patch-package"');
    const patchPath = join(root, 'patches/react-native-maps+1.27.2.patch');
    expect(existsSync(patchPath)).toBe(true);
    const patch = readFileSync(patchPath, 'utf8');
    expect(patch).toContain('showsTransit');
    expect(patch).toMatch(/setTransitEnabled|transitEnabled/);
    // setTransitEnabled requires play-services-maps ≥ 20.0.0
    expect(patch).toMatch(/googlePlayServicesMapsVersion|20\.0\.0/);
    // New Architecture / Fabric path (app has newArchEnabled=true).
    expect(patch).toContain('com/rnmaps/fabric/MapViewManager.java');
    expect(patch).toContain('setShowsTransit');
    expect(patch).toContain('NativeComponentGoogleMapView.ts');
    expect(patch).toContain('RNMapsMapViewManagerDelegate.java');
    expect(patch).toContain('RNMapsSpecs/Props.h');
    expect(patch).toContain('RNMapsSpecs/Props.cpp');
  });

  it('uses Apple standard POIs including public transport (not exclusive filter)', () => {
    expect(mapsBoundary).toContain('showsPointsOfInterests: true');
    expect(mapsBoundary).not.toContain('APPLE_TRANSIT_POI_FILTER');
    expect(mapsBoundary).not.toContain('pointsOfInterestFilter:');
    expect(groupMap).toContain('no Google-equivalent transit network toggle');
  });

  it('keeps MapKit transit as a directions transport type', () => {
    expect(mapsModuleIos).toContain('case "transit": request.transportType = .transit');
  });

  it('does not introduce a third-party transit dataset or custom rail overlay', () => {
    expect(groupMap).not.toContain('openstreetmap-transit');
    expect(groupMap).not.toContain('customRailOverlay');
    expect(groupMap).not.toContain('OverlayPolyline.transitNetwork');
  });
});
