import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

it('uses SDK 57 with the fixed RN and Hermes memory regression versions', () => {
  const semver = require('semver');
  const expo = require('expo/package.json');
  const rn = require('react-native/package.json');
  expect(semver.satisfies(expo.version, '>=57.0.17 <58')).toBe(true);
  expect(semver.satisfies(rn.version, '>=0.86.3 <0.87')).toBe(true);
  expect(semver.gte(rn.dependencies['hermes-compiler'], '250829098.0.17')).toBe(true);
});

it('keeps Expo, RN, Hermes, engine config and OTA runtime aligned', () => {
  const result = spawnSync(
    process.execPath,
    [join(__dirname, '../../scripts/verify-runtime-alignment.mjs')],
    { cwd: join(__dirname, '../..'), encoding: 'utf8' },
  );
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('runtime alignment ok');
});
