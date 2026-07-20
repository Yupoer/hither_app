import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const notificationsSrc = readFileSync(
  join(__dirname, '../native/notifications.ts'),
  'utf8',
);

describe('notifications boundary remote push guard', () => {
  it('is the module that imports expo-notifications for app JS', () => {
    expect(notificationsSrc).toMatch(/from 'expo-notifications'/);
  });

  it('guards Android Expo Go before device push token fetch', () => {
    expect(notificationsSrc).toMatch(/expo-constants/);
    expect(notificationsSrc).toMatch(
      /executionEnvironment|appOwnership|StoreClient/,
    );
    expect(notificationsSrc).toMatch(/getDevicePushTokenAsync/);
    expect(notificationsSrc).toMatch(/development build/i);
    expect(notificationsSrc).toMatch(/Android Expo Go/i);
  });

  it('does not disable all Android push with Platform.OS alone', () => {
    if (notificationsSrc.includes('Platform.OS')) {
      expect(notificationsSrc).toMatch(/android/i);
      expect(notificationsSrc).toMatch(
        /executionEnvironment|appOwnership|StoreClient/,
      );
    }
  });
});
