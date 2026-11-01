import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

jest.setTimeout(90000);

it('headless compilation cache reloads edited source and inherited TypeScript options across isolated processes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hither-loader-contract-'));
  const loader = path.resolve('test/headless/loader.cjs');
  const sourceFile = path.join(directory, 'source.ts');
  const inheritedConfig = path.join(directory, 'inherited.json');
  const source = (version: number) => `export const version = ${version};
    export const assigned: number[] = [];
    class Base { set marker(value: number) { assigned.push(value); } }
    class Child extends Base { marker = 7; }
    new Child();`;
  const run = () => {
    const script = `const loader = require(${JSON.stringify(loader)}).install({ mobileRoot: ${JSON.stringify(directory)} });
      try { const result = require(${JSON.stringify(sourceFile)}); process.stdout.write(JSON.stringify(result)); }
      finally { loader.cleanup(); }`;
    const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 20000,
      env: { ...process.env, HITHER_HEADLESS_DEVICE: JSON.stringify({ id: 'cache-proof', platform: 'ios', directory }) } });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  try {
    fs.mkdirSync(path.join(directory, 'test/headless'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'hither-loader-contract', private: true, type: 'commonjs' }));
    fs.copyFileSync(path.resolve('test/headless/asset.cjs'), path.join(directory, 'test/headless/asset.cjs'));
    fs.writeFileSync(path.join(directory, 'jest.config.js'), 'module.exports = {};');
    fs.writeFileSync(path.join(directory, 'test/headless/actor.config.cjs'), `module.exports = {
      transform: { '^.+\\\\.tsx?$': ['ts-jest', { tsconfig: { module: 'commonjs', esModuleInterop: true, isolatedModules: true } }] }
    };`);
    fs.writeFileSync(path.join(directory, 'tsconfig.json'), JSON.stringify({ extends: './inherited.json', compilerOptions: { types: [] }, include: ['*.ts'] }));
    fs.writeFileSync(inheritedConfig, JSON.stringify({ compilerOptions: { target: 'ES2019', moduleResolution: 'bundler', useDefineForClassFields: false } }));
    fs.writeFileSync(sourceFile, source(1));
    expect(run()).toEqual({ version: 1, assigned: [7] });
    fs.writeFileSync(sourceFile, source(2));
    expect(run()).toEqual({ version: 2, assigned: [7] });
    fs.writeFileSync(inheritedConfig, JSON.stringify({ compilerOptions: { target: 'ES2019', moduleResolution: 'bundler', useDefineForClassFields: true } }));
    expect(run()).toEqual({ version: 2, assigned: [] });
  } finally {
    const resolved = path.resolve(directory);
    assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('hither-loader-contract-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
