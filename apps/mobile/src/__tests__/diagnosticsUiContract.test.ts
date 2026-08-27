import { existsSync, readFileSync } from 'node:fs';
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

  it('shows a location-sharing switch with an explicit local-navigation warning in Tools', () => {
    expect(map).toContain('sharingEnabled');
    expect(map).toContain('handleSharingEnabledChange');
    expect(map).toContain("t('settings.locationSharing')");
    expect(map).toContain("t('settings.locationSharingHint')");
    expect(map).toContain('testID="members-location-sharing"');
    expect(settings).not.toContain("t('settings.locationSharing')");
  });

  it('stops background sharing, purges queued locations, and ACKs the active session', () => {
    const start = map.indexOf('const handleSharingEnabledChange');
    const end = map.indexOf('\n  }, [setSharingEnabled', start);
    const handler = map.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(handler).toContain('setSharingEnabled(enabled)');
    expect(handler).toContain('stopBackgroundJourney()');
    expect(handler).toContain('purgeLocationOutbox()');
    expect(handler).toContain("navigationSessionState.ack('sharing_disabled'");
    expect(handler).toContain('setLocationSharingEnabled(enabled)');
    expect(navigationService).toContain("from('member_privacy_settings').upsert");
    expect(navigationService).toContain('local_navigation_enabled: true');
  });

  it('removes diagnostics UI while keeping the underlying store', () => {
    expect(settings).not.toContain('diagnosticsEnabled');
    expect(settings).not.toContain("t('diagnostics.title')");
    expect(settings).not.toContain("t('settings.diagnosticUpload')");
    expect(map).not.toContain('<DiagnosticsOverlay');
    expect(existsSync(join(__dirname, '..', 'screens/MapScreen/components/DiagnosticsOverlay.tsx'))).toBe(false);
    expect(read('state/diagnostics.ts')).toContain('export const diagnostics');
  });

  it('keeps diagnostic consent persistence without exposing settings UI', () => {
    expect(preferences).toContain('diagnosticUploadEnabled');
    expect(preferences).toContain('setDiagnosticUploadEnabled');
    expect(settings).not.toContain('onDiagnosticSwitchChange');
    expect(read('components/SystemToggle.tsx')).toContain('accessibilityRole="switch"');
  });
});
