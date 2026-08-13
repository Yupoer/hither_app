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

  it('force-refreshes self, waits for bounded peer responses, then pulls final state', () => {
    expect(mapScreen).toContain(
      'const selfFix = await refreshDeviceLocation({ requireUpload: true })',
    );
    expect(mapScreen).toContain('requestGroupLocationRefresh(groupId)');
    // Success alert removed — cooldown / failure feedback remains.
    expect(mapScreen).toContain('waitForLocationRefreshResponses');
    expect(mapScreen).toContain('requestedAtMs: refreshStartedAtMs');
    expect(mapScreen).toContain('map.refreshLocationsResultPartial');
    expect(mapScreen).toContain('map.refreshLocationsResultNone');
    expect(mapScreen).toContain("t('map.refreshLocationsCooldown'");
    expect(mapScreen).toContain("t('map.setFailedTitle')");
    // Client cooldown early-return + button disable while cooling.
    expect(mapScreen).toContain('refreshCooldownUntil - Date.now()');
    expect(mapScreen).toContain('disabled={refreshing || cooling}');
    // Self path before fan-out in source order; upload required before fan-out.
    const selfIdx = mapScreen.indexOf(
      'const selfFix = await refreshDeviceLocation({ requireUpload: true })',
    );
    const fanIdx = mapScreen.indexOf('requestGroupLocationRefresh(groupId)');
    expect(selfIdx).toBeGreaterThanOrEqual(0);
    expect(fanIdx).toBeGreaterThan(selfIdx);
    // Pull roster after accepted fan-out; false remote pull surfaces failure Alert.
    const pullIdx = mapScreen.indexOf('const pulled = await refresh()', fanIdx);
    expect(pullIdx).toBeGreaterThan(fanIdx);
    expect(mapScreen).toContain('if (!pulled)');
    expect(mapScreen).toContain("Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg'))");
    // Self row freshness prefers local sample after push (not stuck on missing).
    expect(mapScreen).toContain('resolveSelfAwareLastUpdated');
    expect(mapScreen).toContain('deviceCoordsAcceptedAtMs');
  });

  it('registers a headless notification task before the app starts', () => {
    expect(task).toContain('TaskManager.defineTask');
    expect(task).toContain('Notifications.registerTaskAsync');
    expect(task).toContain('location.getCurrentLocation');
    // Durable pending rows are uploaded directly and ACKed by requested_at;
    // the refresh path no longer relies on the local journey outbox.
    expect(task).toContain('listMyPendingLocationRefreshes');
    expect(task).toContain('ingestLocationBatch');
    expect(task).toContain('ackMyLocationRefresh');
    expect(task).not.toContain('enqueueLocationOutbox');
    expect(task).not.toContain('flushLocationOutbox');
    expect(task).toContain('rememberPendingLocationPermission');
    expect(task).toContain('consumePendingLocationPermission');
    expect(mapScreen).toContain('consumePendingLocationPermission');
    expect(mapScreen).toContain('backgroundPermissionDeniedRef.current = null');
    expect(entry.indexOf("import './src/state/backgroundLocationRefresh';")).toBeLessThan(
      entry.indexOf("import App from './App';"),
    );
  });
});
