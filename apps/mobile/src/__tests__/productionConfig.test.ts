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
const packageConfig = JSON.parse(
  readFileSync(join(__dirname, '../../package.json'), 'utf8'),
);
const nativeEntitlements = readFileSync(
  join(__dirname, '../../ios/Hither/Hither.entitlements'),
  'utf8',
);
const nativeInfoPlist = readFileSync(join(__dirname, '../../ios/Hither/Info.plist'), 'utf8');
const diagnosticStore = readFileSync(join(__dirname, '../state/diagnostics.ts'), 'utf8');
const xcodeProject = readFileSync(
  join(__dirname, '../../ios/Hither.xcodeproj/project.pbxproj'),
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

  it('separates verbose diagnostic builds from minimal production telemetry', () => {
    expect(easConfig.build.diagnostic).toEqual(
      expect.objectContaining({ distribution: 'store', channel: 'diagnostic' }),
    );
    expect(easConfig.build.diagnostic.env.EXPO_PUBLIC_DIAGNOSTICS_ENABLED).toBe('true');
    expect(easConfig.build.diagnostic.env.EXPO_PUBLIC_DIAGNOSTIC_LEVEL).toBe('verbose');
    expect(easConfig.build.production.env.EXPO_PUBLIC_DIAGNOSTICS_ENABLED).toBe('false');
    expect(easConfig.build.production.env.EXPO_PUBLIC_DIAGNOSTIC_LEVEL).toBe('minimal');
    expect(diagnosticStore).toContain('process.env.EXPO_PUBLIC_DIAGNOSTIC_LEVEL');
  });

  it('wires EAS Update channels on build profiles', () => {
    // Channel is set on the *build* profile; `eas update --channel X` must match.
    // Top-level `update` key is not valid in eas.json schema.
    expect(easConfig.build.production.channel).toBe('production');
    expect(easConfig.build.preview.channel).toBe('preview');
    expect(easConfig.build.development.channel).toBe('development');
    expect(easConfig.update).toBeUndefined();
  });

  it('enables EAS Update (updates.url + manual runtimeVersion for bare workflow)', () => {
    expect(appConfig.expo.updates?.url).toBe(
      'https://u.expo.dev/0f62ed14-1f2e-4d7b-b5b6-4eda273f2e35',
    );
    // Bare workflow (checked-in ios/) cannot use runtimeVersion policies.
    expect(typeof appConfig.expo.runtimeVersion).toBe('string');
    expect(appConfig.expo.runtimeVersion).toBe(appConfig.expo.version);
    expect(appConfig.expo.extra?.eas?.projectId).toBe(
      '0f62ed14-1f2e-4d7b-b5b6-4eda273f2e35',
    );
  });

  it('requests production APNs entitlements for the upcoming archive', () => {
    expect(appConfig.expo.ios.entitlements['aps-environment']).toBe('production');
    expect(nativeEntitlements).toContain('<string>production</string>');
    expect(appConfig.expo.ios.infoPlist.NSSupportsLiveActivitiesFrequentUpdates).toBe(true);
    expect(nativeInfoPlist).toContain('<key>NSSupportsLiveActivitiesFrequentUpdates</key>');
    expect(nativeInfoPlist).toMatch(/<key>UIBackgroundModes<\/key>[\s\S]*<string>location<\/string>/);
  });

  it('keeps checked-in bare iOS configuration aligned before disabling the CNG warning', () => {
    expect(packageConfig.expo.doctor.appConfigFieldsNotSyncedCheck.enabled).toBe(false);
    expect(nativeInfoPlist).toContain('<string>hither</string>');
    expect(nativeInfoPlist).toContain(appConfig.expo.ios.infoPlist.NSLocationWhenInUseUsageDescription);
    expect(nativeInfoPlist).toContain(
      appConfig.expo.ios.infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription,
    );
    expect(nativeInfoPlist).toContain('<string>Dark</string>');
    expect(nativeInfoPlist).toContain('<string>UIInterfaceOrientationPortrait</string>');
  });

  it('ships the checked-in widget target without a runtime Prebuild generator', () => {
    expect(packageConfig.dependencies['@bacons/apple-targets']).toBeUndefined();
    expect(appConfig.expo.plugins).not.toContain('@bacons/apple-targets');
    expect(xcodeProject).toContain('HitherActivityWidget.appex in Embed Foundation Extensions');
    expect(xcodeProject).toContain('PRODUCT_BUNDLE_IDENTIFIER = app.hither.mobile.widget');
  });

  it('keeps every native iOS target on the app.json marketing version', () => {
    const marketingVersions = [
      ...xcodeProject.matchAll(/MARKETING_VERSION = ([^;]+);/g),
    ].map((match) => match[1]);
    expect(marketingVersions.length).toBeGreaterThanOrEqual(4);
    expect(new Set(marketingVersions)).toEqual(new Set([appConfig.expo.version]));
  });
});
