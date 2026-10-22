import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const modes: ('production' | 'development')[] = ['production', 'development'];
it.each(modes)('preserves actual GroupMap commit/session/native wiring in %s with Compiler and StrictMode', mode => {
  const run = spawnSync(process.execPath, [join(__dirname, '../../scripts/check-group-map-commit-lifecycle.cjs')], {
    encoding: 'utf8', env: { ...process.env, NODE_ENV: mode }, timeout: 60_000,
  });
  expect({ status: run.status, error: run.error?.message, stderr: run.stderr }).toEqual({ status: 0, error: undefined, stderr: '' });
  expect(JSON.parse(run.stdout)).toMatchObject({ mode, cases: 8, passed: true });
}, 65_000);
