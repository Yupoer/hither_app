import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const authFlow = readFileSync(join(__dirname, '../state/useAuthFlow.ts'), 'utf8');
const notifications = readFileSync(
  join(__dirname, '../state/useGroupNotifications.ts'),
  'utf8',
);
const appConfig = JSON.parse(
  readFileSync(join(__dirname, '../../app.json'), 'utf8'),
);
const easConfig = JSON.parse(
  readFileSync(join(__dirname, '../../eas.json'), 'utf8'),
);
const nativeEntitlements = readFileSync(
  join(__dirname, '../../ios/Hither/Hither.entitlements'),
  'utf8',
);

describe('production mobile configuration', () => {
  it('uses the exact standalone OAuth callback for sign-in and identity linking', () => {
    expect(authFlow.match(/makeRedirectUri\(\{\s*scheme: 'hither',\s*path: 'auth\/callback'/g))
      .toHaveLength(2);
  });

  it('keeps realtime local notifications as a development-only fallback', () => {
    expect(notifications).toContain('if (!__DEV__ || !groupId || !myUserId) return;');
  });

  it('has store and internal-distribution EAS profiles', () => {
    expect(easConfig.build.production).toEqual(
      expect.objectContaining({ distribution: 'store', autoIncrement: true }),
    );
    expect(easConfig.build.preview).toEqual(
      expect.objectContaining({ distribution: 'internal' }),
    );
  });

  it('requests production APNs entitlements for the upcoming archive', () => {
    expect(appConfig.expo.ios.entitlements['aps-environment']).toBe('production');
    expect(nativeEntitlements).toContain('<string>production</string>');
  });
});
