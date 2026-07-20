import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../modules/hither-live-activity/android');
const servicePath = join(
  root,
  'src/main/java/expo/modules/hitherliveactivity/HitherLiveUpdateService.kt',
);
const messagingPath = join(
  root,
  'src/main/java/expo/modules/hitherliveactivity/HitherMessagingService.kt',
);
const modulePath = join(
  root,
  'src/main/java/expo/modules/hitherliveactivity/HitherLiveActivityModule.kt',
);
const jsBridge = readFileSync(join(__dirname, '../native/liveActivity.ts'), 'utf8');

describe('Android Live Update contract', () => {
  it('uses ProgressStyle on API 36 and a normal ongoing notification below 36', () => {
    expect(existsSync(servicePath)).toBe(true);
    const androidService = readFileSync(servicePath, 'utf8');
    expect(androidService).toContain('Build.VERSION.SDK_INT >= 36');
    expect(androidService).toContain('Notification.ProgressStyle');
    expect(androidService).toContain('setOngoing(true)');
    expect(androidService).not.toContain('RemoteViews');
  });

  it('defines hither_navigation channel and stop action content', () => {
    const androidService = readFileSync(servicePath, 'utf8');
    expect(androidService).toContain('hither_navigation');
    expect(androidService).toContain('停止導航');
    expect(androidService).toContain('THROTTLE_MS = 5_000');
    expect(androidService).toContain('THROTTLE_DISTANCE_M = 20');
  });

  it('exposes the shared Live Activity method surface on Android', () => {
    const androidModule = readFileSync(modulePath, 'utf8');
    for (const name of [
      'isSupported',
      'startGroupActivity',
      'updateGroupActivity',
      'updateAllGroupActivities',
      'endGroupActivity',
      'endAllGroupActivities',
    ]) {
      expect(androidModule).toContain(name);
    }
    expect(androidModule).toContain('HitherLiveUpdateService');
    expect(jsBridge).toContain('startGroupActivity');
    expect(jsBridge).toContain('updateAllGroupActivities');
  });

  it('handles navigation FCM data without claiming general alerts', () => {
    expect(existsSync(messagingPath)).toBe(true);
    const messaging = readFileSync(messagingPath, 'utf8');
    expect(messaging).toContain('navigation_session');
    expect(messaging).toContain('journey');
    expect(messaging).toContain('arrival');
    expect(messaging).toContain('HitherLiveUpdateService.handleFcmData');
  });
});
