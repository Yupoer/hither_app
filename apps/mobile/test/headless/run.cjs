const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { catalog, gaps, inventoryEntries, exclusions } = require('./actions.cjs');
if (process.argv.includes('--list')) {
  const actions = catalog();
  console.log(JSON.stringify({ count: actions.length, actions, unsupported: gaps }, null, 2));
} else if (process.argv.includes('--inventory')) {
  const result = require('./inventory.cjs').audit(inventoryEntries(), exclusions());
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.errors.length || result.missing.length ? 1 : 0;
} else {
  const suites = fs.readdirSync(path.resolve(__dirname, '../../src/__tests__'))
    .filter(file => /^headless.*\.test\.tsx?$/.test(file)).sort().map(file => `src/__tests__/${file}`);
  const result = spawnSync(process.execPath, [require.resolve('jest/bin/jest'), '--runInBand', '--silent',
    '--runTestsByPath', ...suites,
    ...process.argv.slice(2)], { cwd: path.dirname(require.resolve('../../package.json')), stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
