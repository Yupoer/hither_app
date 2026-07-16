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
