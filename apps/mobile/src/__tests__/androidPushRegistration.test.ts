/**
 * Android FCM token registration contracts.
 *
 * Regression: optional native module returning null must fall through to
 * expo-notifications (FCM on Android / APNs on iOS). Platform must be
 * persisted with the token so send-push can fan out correctly.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const notificationsSrc = readFileSync(
  join(__dirname, '../native/notifications.ts'),
  'utf8',
);
const pushRegistrationSrc = readFileSync(
  join(__dirname, '../state/usePushRegistration.ts'),
  'utf8',
);
const notificationServiceSrc = readFileSync(
  join(__dirname, '../api/services/NotificationService.ts'),
  'utf8',
);
const androidModuleSrc = readFileSync(
  join(
    __dirname,
    '../../modules/hither-notifications/android/src/main/java/expo/modules/hithernotifications/HitherNotificationsModule.kt',
  ),
  'utf8',
);

describe('android push registration', () => {
  it('falls through to expo-notifications when optional native module returns null', () => {
    // Non-empty native string is used; null/empty continues to Expo.
    expect(notificationsSrc).toMatch(
      /fromNative\s*(!=|!==)\s*null|typeof fromNative === ['"]string['"]/,
    );
    expect(notificationsSrc).toContain('getDevicePushTokenAsync');
    // Must NOT short-circuit Android to null when native returns null.
    expect(notificationsSrc).not.toMatch(
      /if \(fromNative != null\) return fromNative;[\s\S]*if \(Platform\.OS === ['"]android['"]\) return null;/,
    );
  });

  it('only accepts non-empty native token strings', () => {
    expect(notificationsSrc).toMatch(
      /typeof fromNative === ['"]string['"][\s\S]*fromNative\.length|fromNative\s*&&\s*fromNative\.length|fromNative\.trim\(\)/,
    );
  });

  it('registers platform from Platform.OS when saving the token', () => {
    expect(pushRegistrationSrc).toContain("Platform.OS === 'android' ? 'android' : 'ios'");
    expect(pushRegistrationSrc).toMatch(/savePushToken\(\s*token\s*,\s*platform\s*\)/);
  });

  it('NotificationService accepts ios | android platform on upsert', () => {
    expect(notificationServiceSrc).toContain("platform: 'ios' | 'android'");
    expect(notificationServiceSrc).toContain('platform');
    expect(notificationServiceSrc).toContain("onConflict: 'user_id,token'");
  });

  it('Android HitherNotifications module does not invent a fake FCM token', () => {
    // Returning null is fine — JS falls through to expo-notifications FCM.
    expect(androidModuleSrc).toContain('getDevicePushToken');
    expect(androidModuleSrc).not.toMatch(/return\s+["']fake/);
  });
});
