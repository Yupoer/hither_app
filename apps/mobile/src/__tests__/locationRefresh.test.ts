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

  it('uses the tested shared refresh action and never disables database reads for cooldown', () => {
    expect(mapScreen).toContain('refreshTeamLocations({');
    expect(mapScreen).toContain('uploadSelf: () => refreshDeviceLocation({ requireUpload: true })');
    expect(mapScreen).toContain('requestPeers: () => requestGroupLocationRefresh(groupId)');
    expect(mapScreen).toContain('disabled={refreshing}');
    expect(mapScreen).toContain('lastUpdated: m.capturedAt ?? m.lastUpdated');
    expect(mapScreen).not.toContain('resolveSelfAwareLastUpdated');
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
