import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const source = fs.readFileSync(new URL('./check-changed-coverage.mjs', import.meta.url), 'utf8');

function run({ files = ['apps/mobile/src/services/example.ts'], threshold = '85', status = 0, signal = null, error = false, pct = '90', summary = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-gate-'));
  try {
    const scripts = path.join(root, 'apps/mobile/scripts');
    fs.mkdirSync(scripts, { recursive: true });
    fs.writeFileSync(path.join(scripts, 'check.mjs'), source.replace("from 'node:child_process'", "from './child-process.mjs'"));
    fs.writeFileSync(path.join(scripts, 'child-process.mjs'), `
      import fs from 'node:fs';
      import path from 'node:path';
      export function execFileSync(command, args) {
        if (args[0] === 'diff') return ${JSON.stringify(files.join('\n'))};
        return '';
      }
      export function spawnSync(command, args, options) {
        console.log('COLLECTED', JSON.stringify(args));
        if (${summary}) {
          const directory = path.join(options.cwd, 'coverage-changed');
          fs.mkdirSync(directory, {recursive: true});
          fs.writeFileSync(path.join(directory, 'coverage-summary.json'), '{"total":{"functions":{"pct":${pct}}}}');
        }
        return {status: ${status}, signal: ${JSON.stringify(signal)}, error: ${error ? "new Error('launch failed')" : 'undefined'}};
      }
    `);
    return spawnSync(process.execPath, [path.join(scripts, 'check.mjs')], {
      encoding: 'utf8', env: { ...process.env, COVERAGE_BASE: 'event-base-sha', COVERAGE_THRESHOLD: threshold },
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('qualifies screen/component logic and nested hooks, while skipping UI-only TSX', () => {
  const result = run({ files: ['apps/mobile/src/screens/helpers.ts', 'apps/mobile/src/components/hooks/useThing.tsx', 'apps/mobile/src/screens/Page.tsx'] });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"src\/screens\/helpers.ts"/);
  assert.match(result.stdout, /"src\/components\/hooks\/useThing.tsx"/);
  assert.doesNotMatch(result.stdout, /Page.tsx/);
});

test('allows documentation-only changes and threshold boundaries', () => {
  assert.equal(run({ files: ['README.md'] }).status, 0);
  assert.equal(run({ threshold: '0', pct: '0' }).status, 0);
  assert.equal(run({ threshold: '100', pct: '100' }).status, 0);
});

test('rejects invalid thresholds before invoking Jest, including when no source changed', () => {
  for (const threshold of ['NaN', 'Infinity', '-1', '101', 'oops']) {
    const result = run({ threshold, files: [] });
    assert.notEqual(result.status, 0, threshold);
    assert.doesNotMatch(result.stdout, /COLLECTED/);
  }
});

test('rejects Jest failures even with a passing summary', () => {
  for (const failure of [{ status: 1 }, { status: null }, { status: null, signal: 'SIGTERM' }, { status: null, error: true }]) {
    const result = run(failure);
    assert.notEqual(result.status, 0, JSON.stringify(failure));
    assert.doesNotMatch(result.stdout, /functions=|PASS/);
  }
});

test('rejects missing, invalid, non-finite and insufficient coverage', () => {
  assert.notEqual(run({ summary: false }).status, 0);
  for (const pct of ['null', '"90"', '1e999', '84.99']) {
    assert.notEqual(run({ pct }).status, 0, pct);
  }
});
