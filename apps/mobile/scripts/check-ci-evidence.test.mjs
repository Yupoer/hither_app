import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('./check-ci-evidence.mjs', import.meta.url);
function check({ missing, coverage = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-evidence-'));
  try {
    const artifacts = path.join(root, 'test-artifacts');
    fs.mkdirSync(artifacts);
    const files = {
      'node-receipt.json': JSON.stringify({ status: 'passed', exitCode: 0, mode: coverage ? 'full-coverage' : 'full-plain', coverage: {summaryPath: 'apps/mobile/coverage-changed/coverage-summary.json'} }),
      'ci-shadow-plan.json': '{}',
      'headless-scenarios.raw.json': JSON.stringify({ accepted: true, rows: [{id:'family',critical:true,status:'passed',cases:[{file:'test.cjs',platform:'ios',status:'passed',tests:[{name:'PRIVATE_CASE'}]}]}] }),
      'headless-scenarios.md': '# Evidence\n\nEvidence /PRIVATE_RUNNER_PATH/node-jest.raw.json.\n',
    };
    for (const [file, bytes] of Object.entries(files)) if (file !== missing) fs.writeFileSync(path.join(artifacts, file), bytes);
    const result = spawnSync(process.execPath, [script.pathname.replace(/^\/(?=[A-Za-z]:)/, ''), artifacts], {cwd:root,encoding:'utf8'});
    if (result.status === 0) result.sanitized = fs.readFileSync(path.join(artifacts, 'headless-scenarios.json'),'utf8') + fs.readFileSync(path.join(artifacts,'headless-scenarios.md'),'utf8');
    return result;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('safe evidence omits private case text and absolute runner paths', () => {
  const result=check();
  assert.equal(result.status,0,result.stderr);
  assert.doesNotMatch(result.sanitized,/PRIVATE_/);
});
test('every required evidence file is mandatory and coverage summary is mode-specific', () => {
  for (const missing of ['node-receipt.json','ci-shadow-plan.json','headless-scenarios.raw.json','headless-scenarios.md']) assert.notEqual(check({missing}).status,0,missing);
  assert.notEqual(check({coverage:true}).status,0);
});
