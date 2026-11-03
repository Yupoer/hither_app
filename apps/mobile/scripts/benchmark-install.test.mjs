import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { comparePair, installedIdentity } from './benchmark-install.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hither-install-benchmark-'));
  fs.mkdirSync(path.join(root, 'node_modules/example'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules/example/node_modules/@scope/nested'), { recursive: true });
  fs.mkdirSync(path.join(root, 'patches'));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ packages: {
    'node_modules/parent/node_modules/example': { version: '1.0.0' },
    'node_modules/@scope/nested': { version: '2.0.0' },
  } }));
  fs.writeFileSync(path.join(root, 'node_modules/example/package.json'), JSON.stringify({ name: 'example', version: '1.0.0' }));
  fs.writeFileSync(path.join(root, 'node_modules/example/node_modules/@scope/nested/package.json'), JSON.stringify({ name: '@scope/nested', version: '2.0.0' }));
  fs.writeFileSync(path.join(root, 'node_modules/example/patched.js'), 'patched implementation');
  fs.writeFileSync(path.join(root, 'patches/example+1.0.0.patch'), '+++ b/node_modules/example/patched.js\n');
  return root;
}

test('installed identity reads the actual Bun layout and covers locked versions and every patched target', () => {
  const root = fixture();
  try {
    const original = installedIdentity(root);
    assert.equal(original.packageCount, 2);
    assert.deepEqual(original.patchedTargets.map(target => target.path), ['node_modules/example/patched.js']);
    fs.writeFileSync(path.join(root, 'node_modules/example/patched.js'), 'wrong implementation');
    assert.notDeepEqual(installedIdentity(root), original);
    fs.writeFileSync(path.join(root, 'node_modules/example/package.json'), '{"name":"example","version":"2.0.0"}');
    assert.throws(() => installedIdentity(root), /does not match the lock/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pair comparison rejects a miss, key drift and unequal patched installation', () => {
  const baseline = { schemaVersion: 2, arm: 'baseline', pair: 1, key: 'exact-key', cacheHit: false, elapsedMs: 100,
    identity: { packageCount: 1, patchedTargets: ['hash'] }, runtimeAlignment: 'passed' };
  const candidate = { ...baseline, arm: 'candidate', cacheHit: true, elapsedMs: 80 };
  assert.equal(comparePair(baseline, candidate).correctnessEqual, true);
  for (const override of [{ schemaVersion: 1 }, { cacheHit: false }, { key: 'other' }, { identity: { patchedTargets: ['wrong'] } }, { runtimeAlignment: 'failed' }]) {
    assert.throws(() => comparePair(baseline, { ...candidate, ...override }));
  }
});

test('CLI times only the setup interval and runs runtime acceptance before writing a receipt', () => {
  const root = fixture();
  try {
    fs.copyFileSync(new URL('./benchmark-install.mjs', import.meta.url), path.join(root, 'scripts/benchmark-install.mjs'));
    fs.writeFileSync(path.join(root, 'scripts/verify-runtime-alignment.mjs'), "console.log('runtime fixture passed');");
    const run = args => spawnSync(process.execPath, ['scripts/benchmark-install.mjs', ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(run(['start', '--output', 'start.json']).status, 0);
    const flags = ['finish', '--start', 'start.json', '--output', 'receipt.json', '--arm', 'candidate', '--pair', '1', '--key', 'exact-key', '--cache-hit', 'true'];
    const result = run(flags);
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(fs.readFileSync(path.join(root, 'receipt.json')));
    assert.ok(receipt.elapsedMs > 0);
    assert.equal(receipt.runtimeAlignment, 'passed');
    fs.unlinkSync(path.join(root, 'receipt.json'));
    fs.writeFileSync(path.join(root, 'scripts/verify-runtime-alignment.mjs'), 'process.exitCode = 1;');
    assert.notEqual(run(flags).status, 0);
    assert.equal(fs.existsSync(path.join(root, 'receipt.json')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
