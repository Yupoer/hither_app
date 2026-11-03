import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compareSamples, parseOptions } from './benchmark-ci.mjs';

const sha = 'a'.repeat(40);
const samples = () => Array.from({ length: 5 }, (_, index) => (index % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'])
  .map(arm => ({ pair: index + 1, arm, elapsedMs: arm === 'baseline' ? 100 + index : 80 + index,
    evidence: { suiteCaseDigest: 'same-cases', coverage: { functions: { total: 2, covered: 2 } } } }))).flat();

test('requires five alternating equal-correctness pairs and strictly separated timing ranges', () => {
  assert.equal(compareSamples(samples()).accepted, true);
  const overlap = samples();
  overlap[1].elapsedMs = 100;
  assert.equal(compareSamples(overlap).accepted, false);
  assert.throws(() => compareSamples(samples().slice(1)), /five complete pairs/);
  const changed = samples();
  changed[2].evidence.coverage.functions.covered = 1;
  assert.throws(() => compareSamples(changed), /correctness evidence differs/);
  const reordered = samples();
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  assert.throws(() => compareSamples(reordered), /pair order/);
});

test('CLI requires an explicit valid mode and pinned base', () => {
  assert.equal(parseOptions(['--mode', 'coverage', '--base', sha]).candidateWorkers, 2);
  for (const args of [[], ['--mode', 'plain', '--base', 'origin/master'],
    ['--mode', 'plain', '--base', sha, '--candidate-workers', '0'], ['--mode', 'plain', '--base', sha, '--unknown', 'x']]) {
    assert.throws(() => parseOptions(args));
  }
});

function fixture({ wrongMode = false, coverage = false, emptyCoverage = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hither-worker-benchmark-'));
  const app = path.join(root, 'apps/mobile');
  fs.mkdirSync(path.join(app, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(app, 'test/headless'), { recursive: true });
  fs.mkdirSync(path.join(app, 'src'), { recursive: true });
  fs.writeFileSync(path.join(app, 'src/source.ts'), 'export const source = () => true;');
  fs.copyFileSync(new URL('./benchmark-ci.mjs', import.meta.url), path.join(app, 'scripts/benchmark-ci.mjs'));
  fs.writeFileSync(path.join(app, 'scripts/check-changed-coverage.mjs'), `
    import fs from 'node:fs'; import path from 'node:path';
    const args = process.argv.slice(2);
    const directory = args[args.indexOf('--artifact-dir') + 1];
    fs.mkdirSync(directory, {recursive: true});
    const identity = {baseSha: '${sha}', headSha: '${sha}', treeSha: '${sha}'};
    const plan = {identity, mode: '${wrongMode || coverage ? 'full-coverage' : 'full-plain'}',
      coverage: {eligibleAppPaths: ${coverage ? "['src/source.ts']" : '[]'}, threshold:85}};
    if (args.includes('--plan-only')) fs.writeFileSync(path.join(directory, 'node-plan.json'), JSON.stringify(plan));
    else {
      const cache = args[args.indexOf('--jest-cache-directory') + 1];
      const compiled = path.resolve('node_modules/.cache/hither-headless/compiled');
      if (fs.existsSync(cache) || fs.existsSync(compiled)) process.exit(2);
      fs.mkdirSync(cache, {recursive:true}); fs.mkdirSync(compiled, {recursive:true});
      fs.appendFileSync('calls.jsonl', JSON.stringify(args) + '\\n');
      fs.writeFileSync(path.join(directory, 'node-receipt.json'), JSON.stringify({identity, mode: plan.mode, status:'passed',
        exitCode:0, suiteCaseDigest:'${'b'.repeat(64)}', coverage:plan.coverage,
        suites:[{counts:{passed:2,failed:0,pending:1,todo:0}}]}));
      fs.writeFileSync(path.join(directory, 'node-jest.raw.json'), JSON.stringify({private:'PRIVATE_RAW_MESSAGE'}));
      if (${coverage}) {
        fs.mkdirSync(path.join(directory, 'coverage'), {recursive:true});
        const functions = {total:${emptyCoverage ? 0 : 2},covered:${emptyCoverage ? 0 : 2},skipped:0,pct:100};
        fs.writeFileSync(path.join(directory,'coverage/coverage-summary.json'), JSON.stringify({total:{functions},
          [path.resolve('src/source.ts')]:{functions}}));
      }
    }
  `);
  fs.writeFileSync(path.join(app, 'test/headless/scenario-coverage.cjs'), `
    const fs = require('node:fs');
    if (!JSON.parse(fs.readFileSync(process.argv[2])).private) process.exit(2);
    fs.writeFileSync(process.argv[3], 'PRIVATE_MARKDOWN');
    console.log(JSON.stringify({accepted:true,total:1,passed:1,criticalTotal:1,criticalPassed:1,evidenceStartTime:Date.now(),
      rows:[{id:'family',critical:true,status:'passed',cases:[{file:'test.js',pattern:'PRIVATE_CASE',platform:'mixed',status:'passed',tests:[{name:'PRIVATE_CASE',status:'passed'}]}]}]}));
  `);
  return { root, app };
}

test('real CLI delegates ten samples, resets both caches, preserves incumbent flags and sanitizes comparison', () => {
  const { root, app } = fixture();
  try {
    const result = spawnSync(process.execPath, ['scripts/benchmark-ci.mjs', '--mode', 'plain', '--base', sha], { cwd: app, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const calls = fs.readFileSync(path.join(app, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(calls.length, 10);
    const workers = calls.map(args => args.includes('--jest-max-workers'));
    assert.deepEqual(workers, [false, true, true, false, false, true, true, false, false, true]);
    assert.ok(calls.every(args => !args.includes('--runInBand')));
    const output = fs.readFileSync(path.join(app, 'test-artifacts/benchmark-plain/comparison.json'), 'utf8');
    assert.doesNotMatch(output, /PRIVATE_|assertionResults|headless-scenarios.md/);
    assert.equal(JSON.parse(output).samples.length, 10);
    assert.match(JSON.parse(output).context.bunVersion, /^\d+\.\d+\.\d+/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('coverage benchmark requires meaningful same-scope function evidence', () => {
  for (const emptyCoverage of [false, true]) {
    const { root, app } = fixture({ coverage: true, emptyCoverage });
    try {
      const result = spawnSync(process.execPath, ['scripts/benchmark-ci.mjs', '--mode', 'coverage', '--base', sha], { cwd: app, encoding: 'utf8' });
      assert.equal(result.status, emptyCoverage ? 1 : 0, result.stderr);
      if (emptyCoverage) assert.match(result.stderr, /positive coherent function coverage/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('preflight mode mismatch aborts before any measured sample', () => {
  const { root, app } = fixture({ wrongMode: true });
  try {
    const result = spawnSync(process.execPath, ['scripts/benchmark-ci.mjs', '--mode', 'plain', '--base', sha], { cwd: app, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /preflight/);
    assert.equal(fs.existsSync(path.join(app, 'calls.jsonl')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
