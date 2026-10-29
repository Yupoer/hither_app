import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const source = fs.readFileSync(new URL('./check-changed-coverage.mjs', import.meta.url), 'utf8');

function run({ files = ['apps/mobile/src/services/example.ts'], threshold = '85', status = 0,
  signal = null, error = false, pct = '90', summary = true, malformed = false,
  ci = false, stale = false, tripleDotFails = false, diffFails = false,
  baseEnv = { COVERAGE_BASE: 'event-base-sha' }, raw = true, zeroSuites = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage gate '));
  try {
    const app = path.join(root, 'apps/mobile');
    const scripts = path.join(app, 'scripts');
    fs.mkdirSync(scripts, { recursive: true });
    fs.writeFileSync(path.join(scripts, 'check.mjs'), source.replace("from 'node:child_process'", "from './child-process.mjs'"));
    if (stale) {
      fs.mkdirSync(path.join(app, 'coverage-changed'), { recursive: true });
      fs.writeFileSync(path.join(app, 'coverage-changed/coverage-summary.json'), '{"total":{"functions":{"pct":100}}}');
      fs.mkdirSync(path.join(app, 'test-artifacts'), { recursive: true });
      fs.writeFileSync(path.join(app, 'test-artifacts/node-jest.raw.json'), 'stale');
      fs.writeFileSync(path.join(app, 'test-artifacts/node-receipt.json'), 'stale');
    }
    fs.writeFileSync(path.join(scripts, 'child-process.mjs'), `
      import fs from 'node:fs';
      import path from 'node:path';
      export function execFileSync(command, args) {
        console.log('GIT', JSON.stringify(args));
        if (args[0] === 'diff') {
          if (${diffFails} || (${tripleDotFails} && args.some(a => a.includes('...')))) throw new Error('diff failed');
          return ${JSON.stringify(files.join('\n'))};
        }
        return 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      }
      export function spawnSync(command, args, options) {
        console.log('COLLECTED', JSON.stringify(args));
        console.log('STALE', fs.existsSync(path.join(options.cwd, 'coverage-changed/coverage-summary.json')),
          fs.existsSync(path.join(options.cwd, 'test-artifacts/node-jest.raw.json')),
          fs.existsSync(path.join(options.cwd, 'test-artifacts/node-receipt.json')));
        if (${summary}) {
          const directory = path.join(options.cwd, 'coverage-changed');
          fs.mkdirSync(directory, {recursive: true});
          fs.writeFileSync(path.join(directory, 'coverage-summary.json'), ${malformed ? "'not json'" : `'{"total":{"functions":{"pct":${pct}}}}'`});
        }
        if (${raw}) {
          fs.mkdirSync(path.join(options.cwd, 'test-artifacts'), {recursive: true});
          fs.writeFileSync(path.join(options.cwd, 'test-artifacts/node-jest.raw.json'), JSON.stringify({
            success: ${status === 0}, numTotalTests: 3, numPassedTests: 1, numFailedTests: 0, numPendingTests: 1, numTodoTests: 1,
            testResults: ${zeroSuites ? '[]' : `[{name: path.join(options.cwd, 'src/__tests__/example.test.ts'), status: 'passed',
              assertionResults: [{status: 'passed'}, {status: 'pending'}, {status: 'todo'}],
              failureMessage: 'PRIVATE_ASSERTION_MESSAGE', console: ['PRIVATE_CONSOLE']}]`},
            environment: 'PRIVATE_ENVIRONMENT'
          }));
        }
        return {status: ${status}, signal: ${JSON.stringify(signal)}, error: ${error ? "new Error('launch failed')" : 'undefined'}};
      }
    `);
    const env = { ...process.env, ...baseEnv, COVERAGE_THRESHOLD: threshold };
    if (!Object.hasOwn(baseEnv, 'COVERAGE_BASE')) delete env.COVERAGE_BASE;
    if (!Object.hasOwn(baseEnv, 'GITHUB_BASE_REF')) delete env.GITHUB_BASE_REF;
    const result = spawnSync(process.execPath, [path.join(scripts, 'check.mjs'), ...(ci ? ['--full-node-tests'] : [])], {
      encoding: 'utf8', env,
    });
    const receiptPath = path.join(app, 'test-artifacts/node-receipt.json');
    result.receipt = fs.existsSync(receiptPath) ? fs.readFileSync(receiptPath, 'utf8') : null;
    return result;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const invocations = result => result.stdout.split('\n').filter(line => line.startsWith('COLLECTED ')).map(line => JSON.parse(line.slice(10)));

test('preserves original source eligibility, trimming, excluded directories and deleted paths', () => {
  const eligible = ['src/screens/helpers.ts', 'src/components/hooks/useThing.tsx', 'src/services/api.tsx', 'src/deleted.ts', 'src/screens/MapScreen/styles.ts'];
  const excluded = ['src/screens/Page.tsx', 'src/components/UI.tsx', 'src/assets/a.ts', 'src/__tests__/a.ts',
    'src/foo__tests__bar.ts', 'src/__mocks__/a.ts', 'src/types/a.ts', 'src/constants/a.ts', 'src/i18n/a.ts',
    'src/theme/a.ts', 'src/styles/a.ts', 'src/file.d.ts', 'src/file.style.ts', 'src/file.styles.tsx', 'src/a.js', 'other/a.ts'];
  const result = run({ files: [...eligible, ...excluded].map(p => `apps/mobile/${p}`).concat('README.md', ' apps/mobile/src/spaced.ts ') });
  assert.equal(result.status, 0, result.stderr);
  const args = invocations(result)[0];
  assert.deepEqual(args.flatMap((arg, i) => arg === '--collectCoverageFrom' ? [args[i + 1]] : []), [...eligible, 'src/spaced.ts']);
});

test('keeps the original serial full coverage flags without test selection', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(invocations(result)[0].filter(arg => !arg.includes('coverage gate ')), [
    'jest', '--runInBand', '--silent', '--forceExit', '--coverage', '--coverageDirectory',
    '--coverageReporters=json-summary', '--coverageReporters=text-summary', '--collectCoverageFrom',
    'src/services/example.ts', '--passWithNoTests',
  ]);
});

test('runs the full node suite exactly once in CI with or without eligible sources', () => {
  for (const files of [['apps/mobile/src/services/example.ts'], ['README.md']]) {
    const result = run({ files, ci: true });
    assert.equal(result.status, 0, result.stderr);
    const calls = invocations(result);
    assert.equal(calls.length, 1);
    const args = calls[0];
    assert.equal(args[0], 'jest');
    assert.equal(args.includes('--coverage'), files[0] !== 'README.md');
    assert.equal(args.includes('--runInBand'), files[0] !== 'README.md');
    assert.equal(args.includes('--forceExit'), files[0] !== 'README.md');
    assert.equal(args.includes('--silent'), files[0] !== 'README.md');
    assert.ok(args.includes('--json'));
    assert.ok(args.includes('--outputFile=test-artifacts/node-jest.raw.json'));
    assert.ok(args.every(arg => !/findRelatedTests|runTestsByPath|testPath|onlyChanged|changedSince|--config/.test(arg)));
  }
});

test('standalone empty eligibility skips Jest and keeps threshold validation', () => {
  const result = run({ files: ['README.md'] });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(invocations(result).length, 0);
  assert.match(result.stdout, /skip \(ok\)/);
});

test('removes stale summary and result files before either CI execution branch', () => {
  for (const files of [['apps/mobile/src/services/example.ts'], ['README.md']]) {
    const result = run({ files, ci: true, stale: true });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /STALE false false false/);
  }
  assert.notEqual(run({ stale: true, summary: false }).status, 0);
});

test('writes only safe suite identity, status and counts in the CI receipt', () => {
  const result = run({ ci: true });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.receipt);
  assert.doesNotMatch(result.receipt, /PRIVATE_|coverage gate |assertionResults|failureMessage|console|environment/);
  const receipt = JSON.parse(result.receipt);
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.suites[0].path, 'apps/mobile/src/__tests__/example.test.ts');
  assert.equal(receipt.suites[0].runner, 'node-jest');
  assert.deepEqual(receipt.suites[0].counts, { passed: 1, failed: 0, pending: 1, todo: 1 });
});

test('allows threshold boundaries and fails below the exact aggregate threshold', () => {
  for (const [threshold, pct] of [['0', '0'], ['100', '100'], ['85', '85']]) assert.equal(run({ threshold, pct }).status, 0);
  assert.notEqual(run({ pct: '84.99' }).status, 0);
});

test('rejects invalid thresholds before Jest, including empty changes', () => {
  for (const threshold of ['NaN', 'Infinity', '-1', '101', 'oops']) {
    const result = run({ threshold, files: [], ci: true });
    assert.notEqual(result.status, 0, threshold);
    assert.equal(invocations(result).length, 0);
  }
});

test('preserves base precedence and triple-dot then endpoint fallback', () => {
  for (const [baseEnv, base] of [[{ COVERAGE_BASE: 'explicit', GITHUB_BASE_REF: 'topic' }, 'explicit'], [{ GITHUB_BASE_REF: 'topic' }, 'origin/topic'], [{}, 'origin/master']]) {
    const result = run({ baseEnv, tripleDotFails: true });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(JSON.stringify(['diff', '--name-only', `${base}...HEAD`]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.ok(result.stdout.includes(JSON.stringify(['diff', '--name-only', base, 'HEAD'])));
  }
  assert.equal(run({ diffFails: true, ci: true }).status, 2);
  assert.equal(invocations(run({ diffFails: true })).length, 0);
});

test('Jest failures win even over fresh passing coverage and retain the child status', () => {
  for (const failure of [{ status: 7 }, { status: null }, { status: null, signal: 'SIGTERM' }, { status: null, error: true }]) {
    const result = run({ ...failure, ci: true });
    assert.equal(result.status, failure.status === 7 ? 7 : 1, JSON.stringify(failure));
    assert.doesNotMatch(result.stdout, /functions=|PASS/);
    if (result.receipt) assert.equal(JSON.parse(result.receipt).status, 'failed');
  }
});

test('rejects missing, malformed and nonnumeric coverage summaries', () => {
  for (const options of [{ summary: false }, { malformed: true }, ...['null', '"90"', '1e999'].map(pct => ({ pct }))]) {
    assert.notEqual(run(options).status, 0, JSON.stringify(options));
  }
});

test('invalid CI input cannot retain a previous passing receipt', () => {
  assert.equal(run({ ci: true, stale: true, threshold: 'invalid' }).receipt, null);
  assert.equal(run({ ci: true, stale: true, diffFails: true }).receipt, null);
});

test('CI cannot accept a missing fresh Jest result', () => {
  assert.notEqual(run({ ci: true, raw: false }).status, 0);
});

test('full CI rejects zero discovered suites while standalone retains passWithNoTests', () => {
  assert.notEqual(run({ ci: true, zeroSuites: true, pct: '100' }).status, 0);
  assert.equal(run({ zeroSuites: true, pct: '100' }).status, 0);
});
