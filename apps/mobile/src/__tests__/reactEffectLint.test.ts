import { execFileSync } from 'node:child_process';
import path from 'node:path';

const denied = [
  ['named import', "import { useEffect } from 'react';"],
  ['named alias', "import { useEffect as mount } from 'react'; mount(() => {}, []);"],
  ['layout import', "import { useLayoutEffect as mount } from 'react';"],
  ['default member', "import R from 'react'; R.useEffect(() => {}, []);"],
  ['namespace member', "import * as R from 'react'; R.useLayoutEffect(() => {}, []);"],
  ['computed effect', "import R from 'react'; R['useEffect'](() => {}, []);"],
  ['computed layout', "import R from 'react'; R['useLayoutEffect'](() => {}, []);"],
  ['computed template', "import R from 'react'; R[`useEffect`](() => {}, []);"],
  ['named default import', "import { default as R } from 'react'; R.useEffect(() => {}, []);"],
  ['namespace alias', "import R from 'react'; const alias = R; alias.useEffect(() => {}, []);"],
  ['destructure alias', "import R from 'react'; const { useEffect: mount } = R; mount(() => {}, []);"],
  ['require member', "const R = require('react'); R.useEffect(() => {}, []);"],
  ['inline require', "require('react')['useLayoutEffect'](() => {}, []);"],
  ['require destructure', "const { useEffect: mount } = require('react'); mount(() => {}, []);"],
  ['require alias destructure', "const R = require('react'); const alias = R; const { useLayoutEffect: mount } = alias;"],
  ['computed destructure', "const R = require('react'); const { ['useEffect']: mount } = R;"],
  ['require default destructure', "const { default: R } = require('react'); R.useEffect(() => {}, []);"],
  ['named reexport', "export { useEffect as mount } from 'react';"],
  ['layout reexport', "export { useLayoutEffect } from 'react';"],
  ['star reexport', "export * from 'react';"],
  ['namespace reexport', "export * as R from 'react';"],
  ['default reexport', "export { default as R } from 'react';"],
  ['TS import equals effect', "import R = require('react'); R.useEffect(() => {}, []);"],
  ['TS import equals layout', "import R = require('react'); R.useLayoutEffect(() => {}, []);"],
  ['template destructure effect', "import R from 'react'; const { [`useEffect`]: mount } = R; mount(() => {}, []);"],
  ['template destructure layout', "import R from 'react'; const { [`useLayoutEffect`]: mount } = R; mount(() => {}, []);"],
  ['template namespace destructure', "import * as R from 'react'; const { [`default`]: Q } = R; Q.useEffect(() => {}, []);"],
  ['satisfies namespace effect', "import R from 'react'; const Q = R satisfies unknown; Q.useEffect(() => {}, []);"],
  ['satisfies namespace layout', "import R from 'react'; const Q = R satisfies unknown; Q.useLayoutEffect(() => {}, []);"],
  ['default namespace binding', "import * as R from 'react'; const { default: Q = R } = R; Q.useEffect(() => {}, []);"],
  ['default nested binding', "import * as R from 'react'; const { default: { useLayoutEffect: mount } = R } = R; mount(() => {}, []);"],
  ['internal namespace import alias', "import * as R from 'react'; import Q = R; Q.useEffect(() => {}, []);"],
  ['internal effect import alias', "import * as R from 'react'; import mount = R.useEffect; mount(() => {}, []);"],
  ['internal layout import alias', "import * as R from 'react'; import mount = R.useLayoutEffect; mount(() => {}, []);"],
  ['nested internal namespace alias', "import * as R from 'react'; import Q = R; import mount = Q.useEffect; mount(() => {}, []);"],
  ['optional namespace effect', "import R from 'react'; const Q = R?.default; Q.useEffect(() => {}, []);"],
  ['optional namespace layout', "import R from 'react'; const Q = R?.default; Q.useLayoutEffect(() => {}, []);"],
  ['optional namespace destructure', "import R from 'react'; const { useEffect: mount } = R?.default; mount(() => {}, []);"],
  ['asserted namespace', "import R from 'react'; const Q = <typeof R>R; Q.useEffect(() => {}, []);"],
] as const;

const allowed = [
  ['helper import', "import { useMountEffect } from '../hooks/useMountEffect';"],
  ['other React hook', "import { useState } from 'react';"],
  ['other React hook reexport', "export { useState } from 'react';"],
  ['unrelated object', 'const domain = { useEffect() {}, useLayoutEffect() {} }; domain.useEffect(); domain[\'useLayoutEffect\']();'],
  ['unrelated import', "import R, { useEffect } from 'domain'; R.useLayoutEffect(); useEffect();"],
  ['shadowed React', "import R from 'react'; function work(R) { R.useEffect(); }"],
  ['nested shadowed React', "const R = require('react'); function work() { const R = { useEffect() {} }; R.useEffect(); }"],
  ['shadowed require', "function work(require) { require('react').useEffect(); }"],
  ['type import', "import type { useEffect } from 'react';"],
  ['inline type import', "import { type useLayoutEffect } from 'react';"],
  ['type reexport', "export type { useEffect } from 'react';"],
  ['inline type reexport', "export { type useLayoutEffect } from 'react';"],
  ['source string', 'const source = "React.useEffect and useLayoutEffect";'],
  ['unrelated TS import equals effect', "import Domain = require('domain'); Domain.useEffect();"],
  ['unrelated TS import equals method', "import Domain = require('domain'); Domain.run();"],
  ['type TS import equals', "import type R = require('react'); type F = typeof R.useEffect;"],
  ['unrelated template destructure', "const R = { useEffect() {} }; const { [`useEffect`]: mount } = R; mount();"],
  ['unrelated satisfies namespace', "const R = { useEffect() {} }; const Q = R satisfies unknown; Q.useEffect();"],
  ['unrelated default namespace binding', "const R = { default: { useEffect() {} } }; const { default: Q = R.default } = R; Q.useEffect();"],
  ['type-only satisfies namespace', "import type R from 'react'; type Q = typeof R.useEffect;"],
  ['type-source internal alias', "import type * as R from 'react'; import Q = R; type T = typeof Q.useEffect;"],
  ['unrelated internal import alias', "import * as R from 'domain'; import Q = R; Q.useEffect();"],
  ['unrelated optional namespace', "const R = { default: { useEffect() {} } }; const Q = R?.default; Q.useEffect();"],
  ['shadowed optional namespace', "import R from 'react'; function work(R) { const Q = R?.default; Q.useEffect(); }"],
  ['unrelated asserted namespace', "const R = { useEffect() {} }; const Q = <typeof R>R; Q.useEffect();"],
] as const;

const paths = ['src/effectGateFixture.ts', 'src/__tests__/effectGateFixture.test.ts'];
const fixtures = [
  ...paths.flatMap((filePath) => [
    ...denied.map(([name, code]) => ({ name: `${filePath} rejects ${name}`, filePath, code, rejected: true })),
    ...allowed.map(([name, code]) => ({ name: `${filePath} allows ${name}`, filePath, code, rejected: false })),
  ]),
  { name: 'only helper allows raw effect', filePath: 'src/hooks/useMountEffect.ts', code: "import { useEffect } from 'react'; useEffect(() => {}, []);", rejected: false },
  { name: 'helper still rejects layout', filePath: 'src/hooks/useMountEffect.ts', code: "import { useLayoutEffect } from 'react';", rejected: true },
  { name: 'another helper rejects raw effect', filePath: 'src/hooks/otherMountEffect.ts', code: "import { useEffect } from 'react';", rejected: true },
];

describe('actual mobile ESLint React effect gate', () => {
  let results: { name: string; rejected: boolean; fatal: boolean; ignored: boolean }[];

  beforeAll(() => {
    const script = `
      const { ESLint } = require('eslint');
      const fs = require('node:fs');
      (async () => {
        const eslint = new ESLint();
        const results = [];
        for (const fixture of JSON.parse(fs.readFileSync(0, 'utf8'))) {
          const [result] = await eslint.lintText(fixture.code, { filePath: fixture.filePath });
          results.push({ name: fixture.name,
            rejected: result.messages.some(m => m.ruleId === 'hither/no-react-effects' && m.severity === 2),
            fatal: result.messages.some(m => m.fatal),
            ignored: result.messages.some(m => m.message.includes('ignored')) });
        }
        process.stdout.write(JSON.stringify(results));
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    results = JSON.parse(execFileSync(process.execPath, ['-e', script], {
      cwd: path.resolve(__dirname, '../..'),
      input: JSON.stringify(fixtures),
      encoding: 'utf8',
    }));
  }, 30000);

  it.each(fixtures)('$name', ({ name, rejected }) => {
    expect(results.find(result => result.name === name)).toEqual({ name, rejected, fatal: false, ignored: false });
  });
});
