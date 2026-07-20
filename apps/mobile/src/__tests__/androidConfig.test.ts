import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const mobileRoot = join(__dirname, '../..');
const repoRoot = join(mobileRoot, '../..');

/**
 * Evaluate app.config via a fresh Node process.
 *
 * Jest + @expo/require-utils loadModuleSync does not reliably observe
 * process.env mutations made inside the Jest worker when evaluating
 * app.config.ts. Real Expo CLI / prebuild run outside Jest, so a child
 * process matches production config evaluation.
 */
function getConfigInChild(env: Record<string, string>): {
  package?: string;
  googleServicesFile?: string;
  mapsApiKey?: string;
  permissions?: string[];
  dump: string;
} {
  const script = `
    const path = require('path');
    const root = process.cwd();
    let getConfig;
    try { getConfig = require('@expo/config').getConfig; }
    catch { getConfig = require('expo/node_modules/@expo/config').getConfig; }
    const exp = getConfig(root, { skipSDKVersionRequirement: true }).exp;
    const out = {
      package: exp.android && exp.android.package,
      googleServicesFile: exp.android && exp.android.googleServicesFile,
      mapsApiKey: exp.android && exp.android.config && exp.android.config.googleMaps
        ? exp.android.config.googleMaps.apiKey
        : undefined,
      permissions: exp.android && exp.android.permissions,
      dump: JSON.stringify(exp),
    };
    process.stdout.write(JSON.stringify(out));
  `;

  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: mobileRoot,
    env: { ...process.env, ...env, NODE_ENV: 'test' },
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(
      `getConfig child failed (status ${result.status}): ${result.stderr || result.stdout}`,
    );
  }

  return JSON.parse(result.stdout) as {
    package?: string;
    googleServicesFile?: string;
    mapsApiKey?: string;
    permissions?: string[];
    dump: string;
  };
}

describe('Android Expo build config', () => {
  it('keeps Android identity and required platform files in generated config', () => {
    const config = getConfigInChild({
      GOOGLE_MAPS_ANDROID_API_KEY: 'test-key',
      GOOGLE_SERVICES_JSON: './google-services.json',
    });

    expect(config.package).toBe('app.hither.mobile');
    expect(config.googleServicesFile).toBeTruthy();
    expect(config.mapsApiKey).toBeTruthy();
    expect(config.mapsApiKey).toBe('test-key');
  });

  it('requests location and POST_NOTIFICATIONS permissions', () => {
    const config = getConfigInChild({
      GOOGLE_MAPS_ANDROID_API_KEY: 'test-key',
    });
    const joined = (config.permissions ?? []).join(' ');
    expect(joined).toMatch(/ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION/);
    expect(joined).toMatch(/POST_NOTIFICATIONS/);
  });

  it('exposes an internal Android APK QA profile', () => {
    const eas = JSON.parse(readFileSync(join(mobileRoot, 'eas.json'), 'utf8')) as {
      build: { androidQa?: { distribution?: string; android?: { buildType?: string } } };
    };
    expect(eas.build.androidQa?.distribution).toBe('internal');
    expect(eas.build.androidQa?.android?.buildType).toBe('apk');
  });

  it('ignores secrets and Firebase Admin service-account material', () => {
    const gitignore = readFileSync(join(mobileRoot, '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/secrets\//);
    expect(gitignore).toMatch(/firebase-adminsdk|\*\.env/);
    const secretsPath = join(mobileRoot, 'secrets');
    if (existsSync(secretsPath)) {
      expect(gitignore).toContain('secrets/');
    }
    const config = getConfigInChild({
      GOOGLE_MAPS_ANDROID_API_KEY: 'test-key',
    });
    expect(config.dump).not.toMatch(/BEGIN PRIVATE KEY/);
    expect(config.dump).not.toMatch(/private_key/);
  });

  it('ships dynamic app.config.ts for env injection', () => {
    const appConfig = readFileSync(join(mobileRoot, 'app.config.ts'), 'utf8');
    expect(appConfig).toContain('GOOGLE_MAPS_ANDROID_API_KEY');
    expect(appConfig).toContain('GOOGLE_SERVICES_JSON');
    expect(appConfig).toContain('googleMaps');
    expect(existsSync(join(repoRoot, 'supabase'))).toBe(true);
  });

  it('documents GOOGLE_MAPS_ANDROID_API_KEY in .env.example without real secrets', () => {
    const example = readFileSync(join(mobileRoot, '.env.example'), 'utf8');
    expect(example).toMatch(/GOOGLE_MAPS_ANDROID_API_KEY=/);
    expect(example).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
  });
});
