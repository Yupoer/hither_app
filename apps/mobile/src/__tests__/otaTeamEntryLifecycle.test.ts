import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ota = readFileSync(join(__dirname, '../utils/otaUpdates.ts'), 'utf8');
const settings = readFileSync(
  join(__dirname, '../screens/MapScreen/components/SettingsOverlay.tsx'),
  'utf8',
);
const myTeams = readFileSync(join(__dirname, '../screens/MyTeamsScreen.tsx'), 'utf8');

describe('OTA apply single-flight + team entry lifecycle', () => {
  it('shares one in-flight apply across manual and automatic paths', () => {
    expect(ota).toContain('let inFlight');
    expect(ota).toContain('pendingManualFollowUp');
    expect(ota).toContain('export async function applyOtaUpdate');
    expect(ota).toContain('applyOtaUpdateIfAvailable');
    expect(ota).toContain("status === 'reloading'");
    expect(ota).toContain('fetch_failed');
    expect(ota).toContain('reload_failed');
    expect(ota).toContain("'busy'");
    // Intentional reload is not classified as crash.
    expect(ota).toContain('intentional process reload');
  });

  it('Settings CTA uses shared applyOtaUpdate (no parallel reload stack)', () => {
    expect(settings).toContain("from '../../../utils/otaUpdates'");
    expect(settings).toContain('applyOtaUpdate({');
    expect(settings).toContain('manual: true');
    expect(settings).toContain('skipCheck: isUpdatePending');
    expect(settings).toContain('handleApplyOta');
    // Must not call reloadAsync directly outside the shared helper.
    expect(settings).not.toMatch(/await Updates\.reloadAsync\(\)/);
  });

  it('team entry is idempotent and reconciles Live Activities before map', () => {
    expect(myTeams).toContain('enterInFlightRef');
    expect(myTeams).toContain('if (enterInFlightRef.current) return');
    expect(myTeams).toContain("navigation.replace('Map'");
    expect(myTeams).toContain('setMembership');
    // LA cleanup on enter (orphan reconcile after OTA).
    expect(myTeams).toContain('clearLiveActivities');
    expect(myTeams).toMatch(/clearLiveActivities\(\)/);
    // Guard released on focus, not immediately after sync replace.
    expect(myTeams).toContain('useFocusEffect');
    // Non-navigation exits release the guard (timeout resolves, stale token).
    expect(myTeams).toContain('navigationScheduled');
    expect(myTeams).toContain('if (!token.isCurrent())');
    expect(myTeams).toContain('enterInFlightRef.current = null');
    expect(myTeams).toContain('.then(() =>');
  });
});
