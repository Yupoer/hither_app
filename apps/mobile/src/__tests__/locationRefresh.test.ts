import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('remote location refresh wiring', () => {
  const mapScreen = readFileSync(
    join(__dirname, '../screens/MapScreen.tsx'),
    'utf8',
  );
  const task = readFileSync(
    join(__dirname, '../state/backgroundLocationRefresh.ts'),
    'utf8',
  );
  const entry = readFileSync(join(__dirname, '../../index.ts'), 'utf8');

  it('uses the server refresh request instead of uploading the sender location', () => {
    expect(mapScreen).toContain('requestGroupLocationRefresh');
    expect(mapScreen).toContain('retryAfterSeconds');
    expect(mapScreen).not.toContain('refreshLocations(refreshDeviceLocation, refresh)');
  });

  it('force-refreshes self first, then peer fan-out, and stays silent on success', () => {
    expect(mapScreen).toContain('const selfFix = await refreshDeviceLocation()');
    expect(mapScreen).toContain('requestGroupLocationRefresh(groupId)');
    // Success alert removed — cooldown / failure feedback remains.
    expect(mapScreen).not.toContain("Alert.alert(t('map.refreshLocationsAccepted'))");
    expect(mapScreen).toContain("t('map.refreshLocationsCooldown'");
    expect(mapScreen).toContain("t('map.setFailedTitle')");
    // Client cooldown early-return + button disable while cooling.
    expect(mapScreen).toContain('refreshCooldownUntil - Date.now()');
    expect(mapScreen).toContain('disabled={refreshing || cooling}');
    // Self path before fan-out in source order.
    const selfIdx = mapScreen.indexOf('const selfFix = await refreshDeviceLocation()');
    const fanIdx = mapScreen.indexOf('requestGroupLocationRefresh(groupId)');
    expect(selfIdx).toBeGreaterThanOrEqual(0);
    expect(fanIdx).toBeGreaterThan(selfIdx);
  });

  it('registers a headless notification task before the app starts', () => {
    expect(task).toContain('TaskManager.defineTask');
    expect(task).toContain('Notifications.registerTaskAsync');
    expect(task).toContain('location.getCurrentLocation');
    expect(task).toContain('enqueueLocationOutbox');
    expect(task).toContain('flushLocationOutbox');
    expect(task).toContain('rememberPendingLocationPermission');
    expect(task).toContain('consumePendingLocationPermission');
    expect(mapScreen).toContain('consumePendingLocationPermission');
    expect(mapScreen).toContain('backgroundPermissionDeniedRef.current = null');
    expect(entry.indexOf("import './src/state/backgroundLocationRefresh';")).toBeLessThan(
      entry.indexOf("import App from './App';"),
    );
  });
});
