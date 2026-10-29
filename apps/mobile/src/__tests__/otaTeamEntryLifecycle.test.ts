import { readFileSync } from 'node:fs';
import { join } from 'node:path';

jest.mock('expo-updates', () => ({
  isEnabled: true,
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));
jest.mock('react-native', () => ({ AppState: {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({}));

import * as Updates from 'expo-updates';
import {
  __setOtaUsableForTests,
  applyOtaUpdate,
  applyOtaUpdateIfAvailable,
  isOtaApplyInFlight,
} from '../utils/otaUpdates';

const settings = readFileSync(
  join(__dirname, '../screens/MapScreen/components/SettingsOverlay.tsx'),
  'utf8',
);
const myTeams = readFileSync(join(__dirname, '../screens/MyTeamsScreen.tsx'), 'utf8');

describe('OTA apply single-flight + team entry lifecycle', () => {
  it('holds automatic and manual callers until their single runtime reload completes', async () => {
    const check = Updates.checkForUpdateAsync as jest.Mock;
    const fetch = Updates.fetchUpdateAsync as jest.Mock;
    const reload = Updates.reloadAsync as jest.Mock;
    check.mockResolvedValue({ isAvailable: true });
    fetch.mockResolvedValue({ isNew: true });
    let finishReload!: () => void;
    let reloadStarted!: () => void;
    const started = new Promise<void>((resolve) => { reloadStarted = resolve; });
    reload.mockImplementation(() => new Promise<void>((resolve) => {
      finishReload = resolve;
      reloadStarted();
    }));
    __setOtaUsableForTests(true);
    try {
      const automatic = applyOtaUpdateIfAvailable();
      await started;
      const manual = applyOtaUpdate({ manual: true, skipCheck: true });
      let settled = false;
      void automatic.then(() => { settled = true; });
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(isOtaApplyInFlight()).toBe(true);
      finishReload();
      await expect(Promise.all([automatic, manual])).resolves.toEqual([
        true, { status: 'reloading', reloading: true },
      ]);
      expect(check).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(reload).toHaveBeenCalledTimes(1);
      expect(isOtaApplyInFlight()).toBe(false);
    } finally {
      __setOtaUsableForTests(null);
    }
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
    // Entering the map must not kill an active journey. Explicit leave still clears.
    const entry = myTeams.slice(myTeams.indexOf("'my_teams.enter_group'"), myTeams.indexOf("navigation.replace('Map'"));
    expect(entry).not.toContain('clearLiveActivities(');
    // Guard released on focus, not immediately after sync replace.
    expect(myTeams).toContain('useFocusEffect');
    // Non-navigation exits release the guard (timeout resolves, stale token).
    expect(myTeams).toContain('navigationScheduled');
    expect(myTeams).toContain('if (!token.isCurrent())');
    expect(myTeams).toContain('enterInFlightRef.current = null');
    expect(myTeams).toContain('.then(() =>');
  });
});
