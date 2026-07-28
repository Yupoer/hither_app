import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../..');
const groupMap = readFileSync(join(__dirname, '../components/GroupMap.tsx'), 'utf8');
const mapsModuleIos = readFileSync(
  join(__dirname, '../../modules/hither-maps/ios/HitherMapsModule.swift'),
  'utf8',
);
const packageJson = readFileSync(join(root, 'package.json'), 'utf8');

describe('transit-oriented map defaults', () => {
  it('enables Google transit layer prop on Android by default', () => {
    expect(groupMap).toContain("Platform.OS === 'android'");
    expect(groupMap).toContain('showsTransit: true');
    expect(groupMap).toContain('showsTransit');
  });

  it('keeps showsTransit durable via patch-package postinstall', () => {
    expect(packageJson).toContain('patch-package');
    expect(packageJson).toContain('"postinstall": "patch-package"');
    const patchPath = join(root, 'patches/react-native-maps+1.27.2.patch');
    expect(existsSync(patchPath)).toBe(true);
    const patch = readFileSync(patchPath, 'utf8');
    expect(patch).toContain('showsTransit');
    expect(patch).toMatch(/setTransitEnabled|transitEnabled/);
    // New Architecture / Fabric path (app has newArchEnabled=true).
    expect(patch).toContain('com/rnmaps/fabric/MapViewManager.java');
    expect(patch).toContain('setShowsTransit');
    expect(patch).toContain('NativeComponentGoogleMapView.ts');
    expect(patch).toContain('RNMapsMapViewManagerDelegate.java');
    expect(patch).toContain('RNMapsSpecs/Props.h');
    expect(patch).toContain('RNMapsSpecs/Props.cpp');
  });

  it('uses Apple standard POIs including public transport (not exclusive filter)', () => {
    // Emphasize transit by keeping POIs on (previous code forced them off).
    // Do not exclusive-filter to transit-only categories.
    expect(groupMap).toContain('showsPointsOfInterests: true');
    expect(groupMap).not.toContain('APPLE_TRANSIT_POI_FILTER');
    expect(groupMap).not.toContain('pointsOfInterestFilter:');
    // Spec: do not claim a Google-equivalent transit network toggle on MapKit.
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
