import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(__dirname, '../../scripts/check-test-meta.mjs');

const SOURCE_ONLY = `
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');
it('pins a line', () => {
  expect(src).toContain("import BottomSheet from '../components/BottomSheet'");
});
`;

const EXERCISES_MODULE = `
import { readFileSync } from 'node:fs';
import { formatDistance } from '../utils/distance';
const src = readFileSync('../utils/distance.ts', 'utf8');
it('formats', () => {
  expect(formatDistance(1)).toBe('1 m');
  expect(src.length).toBeGreaterThan(0);
});
`;

let root: string;
let testsRoot: string;
let baseline: string;

function writeTest(name: string, body: string) {
  writeFileSync(join(testsRoot, name), body);
}

function writeBaseline(files: string[]) {
  writeFileSync(baseline, JSON.stringify({ files }));
}

function runMeta() {
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      META_PARENT: 'pure-chore',
      META_SCOPE: 'all',
      META_TESTS_ROOT: testsRoot,
      META_SOURCE_ONLY_BASELINE: baseline,
      META_WRITE_SOURCE_ONLY_BASELINE: '',
    },
  });
  return { status: result.status, out: `${result.stdout}\n${result.stderr}` };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'source-only-ratchet-'));
  testsRoot = join(root, '__tests__');
  mkdirSync(testsRoot);
  writeFileSync(join(testsRoot, 'acceptance-map.json'), JSON.stringify({ entries: [] }));
  baseline = join(root, 'baseline.json');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('source-only test ratchet', () => {
  it('fails when a new test reads production source without importing it', () => {
    writeBaseline([]);
    writeTest('mapLayout.test.ts', SOURCE_ONLY);
    const { status, out } = runMeta();
    expect(status).toBe(1);
    expect(out).toContain('[L2/source-only-test] mapLayout.test.ts');
  });

  it('flags *Contract* tests too', () => {
    writeBaseline([]);
    writeTest('mapLayoutContract.test.ts', SOURCE_ONLY);
    const { status, out } = runMeta();
    expect(status).toBe(1);
    expect(out).toContain('[L2/source-only-test] mapLayoutContract.test.ts');
  });

  it('passes when the source-only test is already in the baseline', () => {
    writeBaseline(['mapLayout.test.ts']);
    writeTest('mapLayout.test.ts', SOURCE_ONLY);
    const { status } = runMeta();
    expect(status).toBe(0);
  });

  it('does not count a test that imports the production module it reads', () => {
    writeBaseline([]);
    writeTest('distance.test.ts', EXERCISES_MODULE);
    const { status, out } = runMeta();
    expect(status).toBe(0);
    expect(out).not.toContain('source-only-test');
  });

  it('passes and asks to shrink the baseline when a file leaves the set', () => {
    writeBaseline(['distance.test.ts', 'deleted.test.ts']);
    writeTest('distance.test.ts', EXERCISES_MODULE);
    const { status, out } = runMeta();
    expect(status).toBe(0);
    expect(out).toContain('2 file(s) left the set; shrink baseline.json');
    expect(out).toContain('  - distance.test.ts');
    expect(out).toContain('  - deleted.test.ts');
  });
});
