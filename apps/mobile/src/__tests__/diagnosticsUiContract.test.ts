import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

describe('location privacy and diagnostics UI contract', () => {
  const preferences = read('state/PreferencesContext.tsx');
  const privacy = read('state/locationPrivacy.ts');
  const settings = read('screens/MapScreen/components/SettingsOverlay.tsx');
  const map = read('screens/MapScreen.tsx');
  const navigationService = read('api/services/NavigationService.ts');

  it('persists the sharing master switch under the stable key and migrates legacy state', () => {
    expect(privacy).toContain("LOCATION_SHARING_KEY = 'pref.sharingEnabled'");
    expect(privacy).toContain("LEGACY_LOCATION_SHARING_KEY = 'pref.locationSharing'");
    expect(preferences).toContain('LEGACY_LOCATION_SHARING_KEY');
    expect(preferences).toContain('AsyncStorage.removeItem(LEGACY_LOCATION_SHARING_KEY)');
  });

  it('shows a location-sharing switch with an explicit local-navigation warning', () => {
    expect(settings).toContain('sharingEnabled');
    expect(settings).toContain('onSharingEnabledChange');
    expect(settings).toContain("t('settings.locationSharing')");
    expect(settings).toContain("t('settings.locationSharingHint')");
  });

  it('stops background sharing, purges queued locations, and ACKs the active session', () => {
    const start = map.indexOf('const handleSharingEnabledChange');
    const end = map.indexOf('\n  };', start);
    const handler = map.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(handler).toContain('setSharingEnabled(enabled)');
    expect(handler).toContain('stopBackgroundJourney()');
    expect(handler).toContain('purgeLocationOutbox()');
    expect(handler).toContain("navigationSessionState.ack('sharing_disabled'");
    expect(handler).toContain('setLocationSharingEnabled(enabled)');
    expect(navigationService).toContain("from('member_privacy_settings').upsert");
    expect(navigationService).toContain('local_navigation_enabled: true');
  });

  it('keeps diagnostics gated and exports a redacted JSON support bundle', () => {
    const diagnostics = read('screens/MapScreen/components/DiagnosticsOverlay.tsx');

    expect(settings).toContain('diagnosticsEnabled');
    expect(settings).toContain("process.env.EXPO_PUBLIC_DIAGNOSTICS_ENABLED === 'true'");
    expect(diagnostics).toContain('buildNumber');
    expect(diagnostics).toContain('navigationSessionId');
    expect(diagnostics).toContain('trackingMode');
    expect(diagnostics).toContain('callbackCount');
    expect(diagnostics).toContain('uploadCount');
    expect(diagnostics).toContain('errorCount');
    expect(diagnostics).toContain('liveActivityStatus');
    expect(diagnostics).toContain('diagnostics.exportJson()');
    expect(diagnostics).toContain('Sharing.share({ message: json })');
  });

  it('exposes DEV-only debug route controls with start/stop and warning', () => {
    const diagnostics = read('screens/MapScreen/components/DiagnosticsOverlay.tsx');
    expect(diagnostics).toContain('__DEV__');
    expect(diagnostics).toContain('startDebugRoute');
    expect(diagnostics).toContain('stopDebugRoute');
    expect(diagnostics).toContain('debugLocation.warning');
  });
});
