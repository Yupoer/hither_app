import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { ALL_GROUPS, buildShadowPlan, parseChanges, observeShadowPlan } from './ci-shadow-plan.mjs';

const identity = { baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40), treeSha: 'c'.repeat(40), diffMode: 'triple-dot' };
const manifest = () => ({ schemaVersion: 1, version: 1, fullFallbackPaths: ['config/'],
  modules: [
    { id: 'producer', paths: ['source/'], groups: ['node'], consumers: [] },
    { id: 'middle', paths: ['middle/'], groups: ['backend'], consumers: ['last'] },
    { id: 'last', paths: ['last/'], groups: ['jsi-ui-runtime'], consumers: ['middle'] },
  ], contracts: [{ id: 'payload', producerPaths: ['source/'], consumers: ['middle'] }] });
const plan = (changes, overrides = {}) => buildShadowPlan({ identity, changes, baseManifest: manifest(), headManifest: manifest(), eligibleAppPaths: ['src/unimported.ts'], ...overrides });

test('contract consumers expand transitively, terminate cycles and retain independent coverage scope', () => {
  const report = plan([{ status: 'M', path: 'source/a.ts' }]);
  assert.equal(report.shadowOnly, true);
  assert.deepEqual(report.affectedModules, ['last', 'middle', 'producer']);
  assert.deepEqual(report.contracts, ['payload']);
  assert.ok(['node', 'backend', 'jsi-ui-runtime'].every(group => report.proposedGroups.includes(group)));
  assert.deepEqual(report.coverageEligibleAppPaths, ['src/unimported.ts']);
  assert.deepEqual(report.fallbackReasons, []);
});

test('base and head declarations both affect rename, deletion and changed edges', () => {
  const base = manifest();
  const head = manifest();
  head.contracts = [];
  head.modules[0].paths = ['renamed/'];
  for (const change of [{ status: 'R', oldPath: 'source/old.ts', path: 'renamed/new.ts' }, { status: 'D', path: 'source/gone.ts' }]) {
    const report = plan([change], { baseManifest: base, headManifest: head });
    assert.deepEqual(report.affectedModules, ['last', 'middle', 'producer']);
    assert.ok(report.proposedGroups.includes('backend'));
    assert.deepEqual(report.fallbackReasons, []);
  }
});

test('unknown, config, shared or unmapped dynamic paths propose every existing group', () => {
  for (const path of ['unknown/path.ts', 'config/runner.js', 'dynamic/registry.cjs']) {
    const report = plan([{ status: 'M', path }]);
    assert.deepEqual(report.proposedGroups, ALL_GROUPS);
    assert.ok(report.fallbackReasons.length > 0);
  }
});

test('invalid identities, manifests, relationships and unsafe change records fail to full fallback', () => {
  const invalid = [null, {}, { ...manifest(), schemaVersion: 99 }, { ...manifest(), version: 'private' }];
  const dangling = manifest(); dangling.modules[0].consumers = ['missing']; invalid.push(dangling);
  const duplicate = manifest(); duplicate.modules.push(duplicate.modules[0]); invalid.push(duplicate);
  for (const baseManifest of invalid) {
    assert.deepEqual(plan([{ status: 'M', path: 'source/a.ts' }], { baseManifest }).proposedGroups, ALL_GROUPS);
  }
  assert.deepEqual(plan([], { identity: { headSha: 'private' } }).proposedGroups, ALL_GROUPS);
  const unsafe = plan([{ status: 'R', oldPath: '../PRIVATE_VALUE', path: '/PRIVATE_VALUE' }]);
  assert.deepEqual(unsafe.proposedGroups, ALL_GROUPS);
  assert.doesNotMatch(JSON.stringify(unsafe), /PRIVATE_VALUE/);
});

test('parses status-aware changes independently without changing the original coverage adapter', () => {
  assert.deepEqual(parseChanges('M\0source/a.ts\0R100\0old/a.ts\0new/a.ts\0D\0source/gone.ts\0'), [
    { status: 'M', path: 'source/a.ts' }, { status: 'R', oldPath: 'old/a.ts', path: 'new/a.ts' }, { status: 'D', path: 'source/gone.ts' },
  ]);
  for (const raw of ['M\0', 'R100\0old.ts\0', 'X\0source.ts\0']) assert.throws(() => parseChanges(raw));
});

test('observation reads pinned base/head declarations and the same diff mode', () => {
  const calls = [];
  const git = args => {
    calls.push(args);
    if (args[0] === 'show') return JSON.stringify(manifest());
    return 'M\0source/a.ts\0';
  };
  const report = observeShadowPlan({ identity, eligibleAppPaths: ['src/unimported.ts'], git });
  assert.deepEqual(report.fallbackReasons, []);
  assert.ok(calls.some(args => args[1] === `${identity.baseSha}:scripts/ci-module-contracts.json`));
  assert.ok(calls.some(args => args[1] === `${identity.headSha}:scripts/ci-module-contracts.json`));
  assert.ok(calls.some(args => args.includes(`${identity.baseSha}...${identity.headSha}`)));
  calls.length = 0;
  observeShadowPlan({ identity: { ...identity, diffMode: 'endpoints' }, eligibleAppPaths: [], git });
  assert.deepEqual(calls.find(args => args[0] === 'diff').slice(-2), [identity.baseSha, identity.headSha]);
});

test('Git or declaration read failures yield safe explicit full fallback', () => {
  const report = observeShadowPlan({ identity, eligibleAppPaths: [], git() { throw new Error('PRIVATE_DIAGNOSTIC'); } });
  assert.deepEqual(report.proposedGroups, ALL_GROUPS);
  assert.ok(report.fallbackReasons.includes('change-or-manifest-read-failed'));
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_DIAGNOSTIC/);
});

test('checked-in registry covers coarse current runtimes and explicitly marks infrastructure/shared inputs', () => {
  const registry = JSON.parse(fs.readFileSync(new URL('./ci-module-contracts.json', import.meta.url)));
  const report = plan([{ status: 'M', path: 'apps/mobile/src/utils/example.ts' }], { baseManifest: registry, headManifest: registry });
  assert.deepEqual(report.fallbackReasons, []);
  assert.ok(report.proposedGroups.includes('node'));
  for (const path of ['.github/workflows/ci.yml', 'apps/mobile/package-lock.json', 'apps/mobile/src/types/coreData.ts', 'apps/mobile/test/headless/app.cjs', 'supabase/functions/_shared/appStoreServerApi.ts']) {
    assert.deepEqual(plan([{ status: 'M', path }], { baseManifest: registry, headManifest: registry }).proposedGroups, ALL_GROUPS);
  }
});

test('checked-in module and producer selectors name tracked sources', () => {
  const registry = JSON.parse(fs.readFileSync(new URL('./ci-module-contracts.json', import.meta.url)));
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' }).split('\0');
  for (const selector of [...registry.modules.flatMap(module => module.paths), ...registry.contracts.flatMap(contract => contract.producerPaths)]) {
    assert.ok(tracked.some(file => selector.endsWith('/') ? file.startsWith(selector) : file === selector), selector);
  }
  for (const [path, contract] of [
    ['apps/mobile/src/state/useGroupNotifications.ts', 'notification-identity-and-vectors'],
    ['apps/mobile/targets/live-activity/HitherLiveActivity.swift', 'live-activity-payload'],
  ]) {
    const report = plan([{ status: 'M', path }], { baseManifest: registry, headManifest: registry });
    assert.ok(report.contracts.includes(contract));
    assert.ok(report.affectedModules.includes('native'));
  }
});
