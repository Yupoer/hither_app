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

const READ_AND_PIN = `
const src = readSource('../utils/distance.ts', 'utf8');
it('pins implementation', () => expect(src).toContain('return'));
`;

function sourceOnlyWith(prelude: string) {
  return `import { readFileSync as readSource } from 'node:fs';\n${prelude}\n${READ_AND_PIN}`;
}

function readingThrough(prelude: string, call: string) {
  return `${prelude}
const src = ${call}('../utils/distance.ts', 'utf8');
it('pins implementation', () => expect(src).toContain('return'));
`;
}

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

  it.each([
    ['a type-only import', "import type { Distance } from '../utils/distance';"],
    ['a type-only named specifier', "import { type Distance } from '../utils/distance';"],
    ['a type re-export', "export type { Distance } from '../utils/distance';"],
    ['a mock-only declaration', "jest.mock('../utils/distance', () => ({}));"],
    [
      'a doMock factory that requires the module',
      "jest.doMock('../utils/distance', () => jest.requireActual('../utils/distance'));",
    ],
    ['a block-commented import', "/*\nimport { formatDistance } from '../utils/distance';\n*/"],
    ['a line-commented import', "// import { formatDistance } from '../utils/distance';"],
    ['an import inside a string', "const fixture = \"import { formatDistance } from '../utils/distance'\";"],
    [
      'an import inside a template',
      "const fixture = `\nimport { formatDistance } from '../utils/distance';\n`;",
    ],
    ['an unused import', "import { formatDistance } from '../utils/distance';"],
    ['an unused require', "const { formatDistance } = require('../utils/distance');"],
    ['a bare side-effect require', "require('../utils/distance');"],
    ['an object property key', "import { formatDistance } from '../utils/distance';\nconst options = { formatDistance: false };"],
    ['a type query', "import { formatDistance } from '../utils/distance';\ntype D = typeof formatDistance;"],
    ['an interface property', "import { formatDistance } from '../utils/distance';\ninterface Options { formatDistance: boolean }"],
    ['a mock-only reference', "import { formatDistance } from '../utils/distance';\njest.mock('../utils/distance', () => ({ formatDistance: jest.fn() }));"],
    ['a mock-only value reference', "import { formatDistance } from '../utils/distance';\njest.mock('../utils/distance', () => ({ actual: formatDistance }));"],
    ['an imported Jest mock factory', "import { jest as testing } from '@jest/globals';\nimport { formatDistance } from '../utils/distance';\ntesting.mock('../utils/distance', () => ({ actual: formatDistance }));"],
    ['a late-imported Jest mock factory', "import { formatDistance } from '../utils/distance';\ntesting.mock('../utils/distance', () => ({ actual: formatDistance }));\nimport { jest as testing } from '@jest/globals';"],
    ['a parenthesized mock factory', "import { formatDistance } from '../utils/distance';\n(jest.mock)('../utils/distance', () => ({ actual: formatDistance }));"],
    ['an element-access mock factory', "import { formatDistance } from '../utils/distance';\njest['mock']('../utils/distance', () => ({ actual: formatDistance }));"],
    ['a required Jest mock factory', "import { formatDistance } from '../utils/distance';\nconst { jest: testing } = require('@jest/globals');\ntesting.mock('../utils/distance', () => ({ actual: formatDistance }));"],
    ['a namespace-imported Jest mock factory', "import * as testing from '@jest/globals';\nimport { formatDistance } from '../utils/distance';\ntesting.jest.mock('../utils/distance', () => ({ actual: formatDistance }));"],
    ['a required Jest namespace mock factory', "import { formatDistance } from '../utils/distance';\nconst testing = require('@jest/globals');\ntesting.jest.mock('../utils/distance', () => ({ actual: formatDistance }));"],
    ['a dynamically imported Jest namespace mock factory', "import { formatDistance } from '../utils/distance';\nconst testing = await import('@jest/globals');\ntesting.jest.mock('../utils/distance', () => ({ actual: formatDistance }));"],
    ['a destructured dynamic Jest import', "import { formatDistance } from '../utils/distance';\nconst { jest: testing } = await import('@jest/globals');\ntesting.mock('../utils/distance', () => ({ actual: formatDistance }));"],
    ['a computed Jest binding', "import { formatDistance } from '../utils/distance';\nconst { ['jest']: testing } = require('@jest/globals');\ntesting.mock('../utils/distance', () => ({ actual: formatDistance }));"],
    ['an aliased mock method', "import { formatDistance } from '../utils/distance';\nconst mock = jest.mock;\nmock('../utils/distance', () => ({ actual: formatDistance }));"],
    ['a nested Jest method binding', "import { formatDistance } from '../utils/distance';\nconst { jest: { mock } } = require('@jest/globals');\nmock('../utils/distance', () => ({ actual: formatDistance }));"],
    ['a late required Jest binding', "import { formatDistance } from '../utils/distance';\ntesting.mock('../utils/distance', () => ({ actual: formatDistance }));\nconst { jest: testing } = require('@jest/globals');"],
    ['a shadowed binding', "import { formatDistance } from '../utils/distance';\nfunction mock(formatDistance: (n: number) => string) { return formatDistance(1); }"],
    ['a type-only heritage reference', "import { Distance } from '../utils/distance';\ninterface Options extends Distance {}"],
    ['a regex after a condition', "import { formatDistance } from '../utils/distance';\nif (src) /formatDistance/.test(src);"],
    ['JSX text', "import { formatDistance } from '../utils/distance';\nconst node = <Text>formatDistance</Text>;"],
    ['a shadowed require', "function mock(require: (s: string) => any) { return require('../utils/distance').formatDistance(1); }"],
  ])('still flags a source-only test with %s', (_label, prelude) => {
    writeBaseline([]);
    const file = _label.includes('JSX') ? 'probe.test.tsx' : 'probe.test.ts';
    writeTest(file, sourceOnlyWith(prelude));
    const { status, out } = runMeta();
    expect(status).toBe(1);
    expect(out).toContain(`[L2/source-only-test] ${file}`);
  });

  it.each([
    ['a used static import', "import { formatDistance } from '../utils/distance';\nformatDistance(1);"],
    ['a used require binding', "const distance = require('../utils/distance');\ndistance.formatDistance(1);"],
    ['an inline require', "expect(require('../utils/distance').formatDistance(1)).toBe('1 m');"],
    ['a used dynamic import', "it('loads', async () => {\n  const d = await import('../utils/distance');\n  d.formatDistance(1);\n});"],
    ['a shorthand value', "import { formatDistance } from '../utils/distance';\nexpect({ formatDistance }).toBeDefined();"],
    ['a computed property value', "import { formatDistance } from '../utils/distance';\nexpect({ [formatDistance(1)]: true }).toBeDefined();"],
    ['a JSX expression after an apostrophe', "import { formatDistance } from '../utils/distance';\nconst node = <Text>It's {formatDistance(1)}</Text>;\nexpect(node.props.children[1]).toBe('1 m');"],
    ['a template expression', "import { formatDistance } from '../utils/distance';\nexpect(`${formatDistance(1)}`).toBe('1 m');"],
    ['a class base value', "import { Distance } from '../utils/distance';\nclass ShortDistance extends Distance {}\nexpect(new ShortDistance()).toBeDefined();"],
    ['a value outside a required Jest mock', "import { formatDistance } from '../utils/distance';\nconst { jest: testing } = require('@jest/globals');\ntesting.mock('../utils/distance', () => ({ actual: formatDistance }));\nformatDistance(1);"],
    ['a value outside a namespace Jest mock', "import * as testing from '@jest/globals';\nimport { formatDistance } from '../utils/distance';\ntesting.jest.mock('../utils/distance', () => ({ actual: formatDistance }));\nformatDistance(1);"],
    ['a shadowed Jest binding', "import { jest as testing } from '@jest/globals';\nimport { formatDistance } from '../utils/distance';\nfunction exercise(testing: { mock: (spec: string, factory: () => string) => void }) { testing.mock('../utils/distance', () => formatDistance(1)); }"],
    ['a shadowed Jest namespace', "import * as testing from '@jest/globals';\nimport { formatDistance } from '../utils/distance';\nfunction exercise(testing: { jest: { mock: (spec: string, factory: () => string) => void } }) { testing.jest.mock('../utils/distance', () => formatDistance(1)); }"],
  ])('does not flag a source-reading test with %s', (_label, prelude) => {
    writeBaseline([]);
    writeTest(_label.includes('JSX') ? 'probe.test.tsx' : 'probe.test.ts', sourceOnlyWith(prelude));
    const { status, out } = runMeta();
    expect(status).toBe(0);
    expect(out).not.toContain('source-only-test');
  });

  it.each([
    ['a named alias from node:fs', "import { readFileSync as read } from 'node:fs';", 'read'],
    ['a named alias from fs', "import { readFileSync as read } from 'fs';", 'read'],
    ['a namespace import', "import * as files from 'fs';", 'files.readFileSync'],
    ['a default import', "import files from 'node:fs';", 'files.readFileSync'],
    ['a destructured require alias', "const { readFileSync: read } = require('fs');", 'read'],
    ['an inline require', '', "require('fs').readFileSync"],
    ['fs.promises.readFile', "import files from 'fs';", 'await files.promises.readFile'],
    ['callback readFile', "import { readFile } from 'node:fs';", 'readFile'],
    ['fs/promises', "import { readFile as read } from 'fs/promises';", 'await read'],
    ['a promises alias', "import { promises as p } from 'node:fs';", 'await p.readFile'],
    [
      'a nested destructured require',
      "const { promises: { readFile: read } } = require('node:fs');",
      'await read',
    ],
    ['an inline promises require', '', "await require('fs').promises.readFile"],
    ['a reader variable alias', "import * as files from 'node:fs';\nconst read = files.readFileSync;", 'read'],
    ['a destructured namespace alias', "import * as files from 'node:fs';\nconst { readFileSync: read } = files;", 'read'],
    ['an element access alias', "import * as files from 'node:fs';\nconst read = files['readFileSync'];", 'read'],
    ['a literal computed namespace binding', "import * as fs from 'node:fs';\nconst { ['readFileSync']: read } = fs;", 'read'],
    ['a nested literal computed promises binding', "import * as fs from 'node:fs';\nconst { ['promises']: { ['readFile']: read } } = fs;", 'await read'],
    ['a computed promises namespace binding', "import * as fs from 'node:fs/promises';\nconst { ['readFile']: read } = fs;", 'await read'],
    ['a computed require binding', "const { ['readFileSync']: read } = require('node:fs');", 'read'],
    ['a computed dynamic import binding', "const { ['readFile']: read } = await import('node:fs/promises');", 'await read'],
    ['a literal template binding', "import * as fs from 'fs';\nconst { [`readFileSync`]: read } = fs;", 'read'],
  ])('detects a source read through %s', (_label, prelude, call) => {
    writeBaseline([]);
    writeTest('probe.test.ts', readingThrough(prelude, call));
    const { status, out } = runMeta();
    expect(status).toBe(1);
    expect(out).toContain('[L2/source-only-test] probe.test.ts');
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
