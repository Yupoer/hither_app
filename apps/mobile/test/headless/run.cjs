const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { catalog, gaps } = require('./actions.cjs');
if (process.argv.includes('--list')) {
  const actions = catalog();
  console.log(JSON.stringify({ count: actions.length, actions, unsupported: gaps }, null, 2));
} else {
  const result = spawnSync(process.execPath, [require.resolve('jest/bin/jest'), '--runInBand', '--silent',
    '--runTestsByPath', 'src/__tests__/headlessScenario.test.ts', 'src/__tests__/headlessHarnessContract.test.ts',
    ...process.argv.slice(2)], { cwd: path.dirname(require.resolve('../../package.json')), stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
