/**
 * Public seam: npm run test:meta / META_PARENT env contract (#178).
 * Required parent bundles must fail L1 when the acceptance map has zero matching entries.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const appRoot = join(__dirname, '../..');
const script = join(appRoot, 'scripts/check-test-meta.mjs');

function runMeta(env: Record<string, string | undefined>) {
  return spawnSync(process.execPath, [script], {
    cwd: appRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

describe('test:meta META_PARENT contract', () => {
  it('fails when META_PARENT is a required parent and the map has zero matching entries', () => {
    // Committed acceptance-map.json starts empty; parent 999 must not silently pass.
    const result = runMeta({ META_PARENT: '999' });
    expect(result.status).not.toBe(0);
    const out = `${result.stdout}\n${result.stderr}`;
    expect(out).toMatch(/parent-entries-missing/);
  });

  it('passes when META_PARENT=pure-chore even if the map has zero entries', () => {
    const result = runMeta({ META_PARENT: 'pure-chore' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[test:meta] PASS');
  });
});

describe('test:coverage:changed argv contract', () => {
  it('does not pass coverageThreshold JSON on the jest argv', () => {
    const src = readFileSync(join(appRoot, 'scripts/check-changed-coverage.mjs'), 'utf8');
    expect(src).not.toMatch(/`--coverageThreshold=/);
    expect(src).toContain('coverage-summary.json');
    expect(src).toContain('functions');
  });
});
