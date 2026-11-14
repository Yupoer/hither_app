#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const repo = path.resolve(__dirname, '../../../..');
const mobile = path.join(repo, 'apps/mobile');
const output = process.argv[2];
assert(output, 'Supply a new evidence directory');
const directory = path.resolve(output);
fs.mkdirSync(directory);
const { World } = require(path.join(mobile, 'test/headless/world.cjs'));
const { LEADER, GROUP_ID, DESTINATION } = require(path.join(mobile, 'test/headless/backend.cjs'));
const doctor = fs.readFileSync(path.join(__dirname, '../SKILL.md'), 'utf8').match(/@'\r?\n([\s\S]*?)\r?\n'@ \| node/)[1];
const results = [];
const source = {
  revision: cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  dirty: cp.execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim(),
  node: process.version,
  command: [process.execPath, __filename, directory],
};
fs.writeFileSync(path.join(directory, 'source.json'), JSON.stringify(source, null, 2) + '\n');

const field = value => value.presentation.hosts.find(host => host.testId === 'map-precise-location');
async function members(world, device) {
  await world.waitFor(device, value => value.presentation.hosts.some(host => host.testId === `gather-card-${DESTINATION}`), 'Map hydration');
  world.check();
  const health = await device.observe();
  assert.equal(health.pid, device.child.pid);
  assert.equal(health.generation, device.generation);
  assert.deepEqual(health.fatal, []);
  assert.equal(health.presentation.route.route, 'Map');
  assert.equal(health.presentation.preferences.ready, true);
  for (const phase of ['onBegin', 'onUpdate', 'onEnd']) {
    const result = await device.host.call({ kind: 'gesture', testId: 'map-bottom-sheet', phase,
      value: phase === 'onBegin' ? {} : { translationY: -250, velocityY: 0 }, success: true });
    assert.equal(result.invoked, true);
  }
  await world.settle();
  const tab = await device.perform('map.tab', { index: 0 });
  assert.notEqual(tab?.invoked, false);
  return world.waitFor(device, value => Boolean(field(value)), 'Members precise location control');
}

async function run() {
  for (const platform of ['ios', 'android']) {
    const preflight = cp.execFileSync(process.execPath, ['--eval', doctor], { cwd: mobile, encoding: 'utf8' });
    fs.writeFileSync(path.join(directory, `${platform}.doctor.log`), preflight);
    const world = new World({ evidenceRoot: path.join(directory, 'worlds') });
    try {
      const device = await world.device({ id: `precise-${platform}`, userId: LEADER, platform,
        screen: { name: 'Map', params: { groupId: GROUP_ID } } });
      const initial = await members(world, device);
      assert.equal(initial.presentation.preferences.highAccuracy, false);
      assert.equal(field(initial).checked, false);
      const gathering = initial.durable.snapshot.activeGathering;
      for (const enabled of [true, false]) {
        const event = await device.host.call({ kind: 'toggle', testId: 'map-precise-location', value: enabled });
        assert.equal(event.invoked, true, 'visible precise location callback must run');
        const changed = await world.waitFor(device, value => value.presentation.preferences.highAccuracy === enabled
          && field(value)?.checked === enabled, 'precise location preference and rendered state');
        assert.deepEqual(changed.durable.snapshot.activeGathering, gathering, 'changing precision must retain the journey');
        await device.restart();
        const restored = await members(world, device);
        assert.equal(restored.presentation.preferences.highAccuracy, enabled, 'precision must survive process restart');
        assert.equal(field(restored).checked, enabled);
        assert.deepEqual(restored.durable.snapshot.activeGathering, gathering);
        results.push({ platform, enabled, persistedAfterRestart: true });
      }
    } finally { await world.close(); }
  }
}

run().then(() => {
  const summary = { passed: results.length, failed: 0, results,
    limits: 'Rendered Map callbacks and device-local preference persistence in isolated Node actors; no native switch rendering, GPS accuracy, sensor cadence, or device acceptance.' };
  fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
}).catch(error => {
  fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify({ passed: results.length, failed: 1, results, error: error.stack }, null, 2) + '\n');
  console.error(error);
  process.exitCode = 1;
});
