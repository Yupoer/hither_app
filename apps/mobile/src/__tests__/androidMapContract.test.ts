import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, '../components/GroupMap.tsx'), 'utf8');
const mapScreen = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');

describe('Android map contract', () => {
  it('selects Google provider only on Android and preserves every shared overlay', () => {
    expect(source).toContain("Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined");
    expect(source).toContain('<DestinationMarker');
    expect(source).toContain('<MemberMarker');
    expect(source).toContain('<PendingPlaceMarker');
    expect(source).toContain('<Polyline');
  });

  it('does not fork the whole map into GroupMap.android.tsx', () => {
    expect(source).toContain('onLongPressCoordinate');
    // Shared component handles long-press; no separate Android map screen file required.
    const fs = require('node:fs') as typeof import('node:fs');
    expect(fs.existsSync(join(__dirname, '../components/GroupMap.android.tsx'))).toBe(false);
  });

  it('binds native map location callbacks only to the iOS MapKit owner', () => {
    expect(source).toContain("...(Platform.OS === 'ios' && onUserLocationSample");
    expect(source).not.toMatch(/onUserLocationChange=\{\(event\) =>/);
  });

  it('records each Android map lifecycle milestone without logging every location callback', () => {
    expect(source).toContain("logEvent('android_map_mount'");
    expect(source).toContain("logEvent('android_map_ready')");
    expect(source).toContain("logEvent('android_map_loaded'");
    expect(source).toContain("logEvent('android_map_unmount'");
    expect(source).toContain('mapReadyToLoadedMs');
    expect(source).toContain("logError('map_loaded_timeout'");
    expect(source).toContain("logEvent('map_loaded_timeout'");
    expect(source).toContain('MAP_LOADED_TIMEOUT_MS');
    // ready→loaded diagnostic only — no timer-driven surface remount
    expect(source).not.toMatch(/setTimeout\([^)]*setSurfaceKey/);
    expect(source).not.toMatch(/setInterval\([^)]*setSurfaceKey/);
    const locationHandlerStart = source.indexOf('onUserLocationChange:');
    expect(locationHandlerStart).toBeGreaterThanOrEqual(0);
    const locationHandler = source.slice(
      locationHandlerStart,
      source.indexOf('}', source.indexOf('onUserLocationSample({', locationHandlerStart) + 1) + 1,
    );
    expect(locationHandler).not.toContain('logEvent(');
  });

  it('locks MapScreen initialCenter to the first available coordinate', () => {
    expect(mapScreen).toContain('const [mapInitialCenter, setMapInitialCenter]');
    expect(mapScreen).toContain('initialCenter={mapInitialCenter ?? undefined}');
    expect(mapScreen).not.toContain('initialCenter={fromCoords}');
  });
});
