import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const memberPresence = readFileSync(join(__dirname, '../screens/MapScreen/hooks/useMemberPresence.ts'), 'utf8');

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

  it('uses the versioned server refresh request', () => {
    expect(mapScreen).toContain('requestGroupLocationRefresh');
    expect(mapScreen).toContain('setRefreshCooldownUntil(result.cooldownUntil)');
    expect(mapScreen).toContain('getAcknowledgedRecipientIds: requestedAt => getGroupLocationRefreshAcknowledgements(groupId, requestedAt)');
    expect(mapScreen).not.toContain('refreshLocations(refreshDeviceLocation, refresh)');
  });

  it('uses the tested shared refresh action and never disables database reads for cooldown', () => {
    expect(mapScreen).toContain('refreshTeamLocations({');
    expect(mapScreen).toContain('uploadSelf: () => refreshDeviceLocation({ requireUpload: true })');
    expect(mapScreen).toContain('requestPeers: () => requestGroupLocationRefresh(groupId)');
    expect(mapScreen).toContain('disabled={refreshing}');
    expect(memberPresence).toContain('lastUpdated: m.capturedAt ?? m.lastUpdated');
    expect(mapScreen).not.toContain('resolveSelfAwareLastUpdated');
  });

  it('registers a headless notification task before the app starts', () => {
    expect(task).toContain('TaskManager.defineTask');
    expect(task).toContain('Notifications.registerTaskAsync');
    expect(task).toContain('location.getCurrentLocation');
    expect(task).toContain('rememberPendingLocationPermission');
    expect(task).toContain('consumePendingLocationPermission');
    const permissionResource = readFileSync(join(__dirname, '../screens/MapScreen/MapScreenResources.tsx'), 'utf8');
    const backgroundResource = readFileSync(join(__dirname, '../screens/MapScreen/MapBackgroundLocationResource.tsx'), 'utf8');
    expect(permissionResource).toContain('consumePendingLocationPermission');
    expect(backgroundResource).toContain('backgroundPermissionDeniedRef.current = null');
    expect(entry.indexOf("import './src/state/backgroundLocationRefresh';")).toBeLessThan(
      entry.indexOf("import App from './App';"),
    );
  });
});
