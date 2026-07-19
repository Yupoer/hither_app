import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

it('keeps Expo, RN, Hermes, engine config and OTA runtime aligned', () => {
  const result = spawnSync(
    process.execPath,
    [join(__dirname, '../../scripts/verify-runtime-alignment.mjs')],
    { cwd: join(__dirname, '../..'), encoding: 'utf8' },
  );
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('runtime alignment ok');
});
